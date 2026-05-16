import { Agent } from "../agent/agent"
import { Config } from "../config/config"
import { MessageV2 } from "../session/message-v2"
import * as Session from "../session/session"
import { SessionPrompt } from "../session/prompt"
import { MessageID } from "../session/schema"
import type { Tool } from "../tool/tool"
import { HeavyArtifact } from "./artifact"
import { HeavyReport } from "./report"
import { HeavySchema } from "./schema"
import { RunHtml } from "../report/html"
import { Cause, Effect, Exit } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { ModelID, ProviderID } from "../provider/schema"
import { Permission } from "@/permission"
import z from "zod"

const params = HeavySchema.Input

type Base = {
  model: {
    modelID: ModelID
    providerID: ProviderID
  }
}

type State = {
  id: string
  title: string
  mode: "direct" | "heavy"
  agent: "explore" | "general"
  goal: string
  deliverable: string
  depth: number
  status: "pending" | "running" | "completed" | "error"
  sessionID: string
  preview: string
  reportPath: string
}

type Task = {
  task: HeavySchema.Plan["tasks"][number]
  result: HeavySchema.Result
  json: string
  md: string
}

type Run = {
  dir: string
  reportPath: string
  reportHtmlPath: string
  paths: HeavySchema.Paths
  plan: HeavySchema.Plan
  states: State[]
  tasks: Task[]
  synth: HeavySchema.Synthesis
}

export namespace HeavyService {
  export const Input = params
  export type Input = z.infer<typeof Input>

  const rules = [
    { permission: "todowrite", pattern: "*", action: "deny" },
    { permission: "todoread", pattern: "*", action: "deny" },
    { permission: "task", pattern: "*", action: "deny" },
    { permission: "map_reduce", pattern: "*", action: "deny" },
    { permission: "heavy_run", pattern: "*", action: "deny" },
    { permission: "edit", pattern: "*", action: "deny" },
    { permission: "write", pattern: "*", action: "deny" },
    { permission: "apply_patch", pattern: "*", action: "deny" },
    { permission: "bash", pattern: "*", action: "deny" },
  ] satisfies Permission.Ruleset

  function text(error: unknown) {
    if (Cause.isCause(error)) return Cause.pretty(error)
    if (error instanceof Error) return error.message
    return String(error)
  }

  function schema(input: z.ZodType) {
    return z.toJSONSchema(input) as Record<string, unknown>
  }

  function model(ctx: Tool.Context) {
    return Effect.gen(function* () {
      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")
      return {
        model: {
          modelID: msg.info.modelID,
          providerID: msg.info.providerID,
        },
      }
    })
  }

  function run(input: {
    ctx: Tool.Context
    base: Base
    agent: "explore" | "general"
    title: string
    prompt: string
    format: z.ZodType
    onStart?: (sessionID: string) => Effect.Effect<void>
  }) {
    return Effect.gen(function* () {
      const agents = yield* Agent.Service
      const config = yield* Config.Service
      const sessions = yield* Session.Service
      const prompts = yield* SessionPrompt.Service
      const bridge = yield* EffectBridge.make()
      const agent = yield* agents.get(input.agent)
      if (!agent) throw new Error(`Agent not found: ${input.agent}`)
      const cfg = yield* config.get()
      const session = yield* sessions.create({
        parentID: input.ctx.sessionID,
        title: input.title,
        permission: [
          ...rules,
          ...(cfg.experimental?.primary_tools?.map((item) => ({
            pattern: "*",
            action: "deny" as const,
            permission: item,
          })) ?? []),
        ],
      })
      if (input.onStart) yield* input.onStart(session.id)

      const cancel = prompts.cancel(session.id)
      function abort() {
        bridge.fork(cancel)
      }

      const message = yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          input.ctx.abort.addEventListener("abort", abort)
        }),
        () =>
          Effect.gen(function* () {
            const parts = yield* prompts.resolvePromptParts(input.prompt)
            return yield* prompts.prompt({
              messageID: MessageID.ascending(),
              sessionID: session.id,
              model: input.base.model,
              agent: agent.name,
              tools: {
                "*": true,
                bash: false,
                edit: false,
                write: false,
                apply_patch: false,
                task: false,
                map_reduce: false,
                heavy_run: false,
              },
              format: {
                type: "json_schema",
                schema: schema(input.format),
                retryCount: 1,
              },
              parts,
            })
          }),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit)) yield* cancel
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                input.ctx.abort.removeEventListener("abort", abort)
              }),
            ),
          ),
      )
      return {
        sessionID: session.id,
        message,
      }
    })
  }

  function parse<T>(msg: MessageV2.WithParts, shape: z.ZodType<T>) {
    if (msg.info.role !== "assistant") throw new Error("Expected assistant message")
    return shape.parse(msg.info.structured)
  }

  function planPrompt(input: Input) {
    return [
      "You are planning a heavy reasoning run. Return structured output only.",
      "",
      `Current depth: ${input.depth}`,
      `Maximum depth: ${input.max_depth}`,
      "Break the request into 2-6 tasks.",
      "Use explore for codebase search/navigation tasks.",
      "Use general for reasoning, synthesis, or architecture tasks.",
      input.depth < input.max_depth
        ? 'Use mode "heavy" only when a task is still broad enough to benefit from another 2-4 task decomposition. Heavy tasks must use agent "general".'
        : 'You are at the depth limit. Set every task mode to "direct".',
      "Each task prompt should be self-contained and specific.",
      "",
      `User query:\n${input.query}`,
      ...(input.context.length ? ["", `Explicit context:\n${input.context.map((item) => `- ${item}`).join("\n")}`] : []),
    ].join("\n")
  }

  function taskPrompt(task: HeavySchema.Plan["tasks"][number], depth: number) {
    return [
      "You are executing one task from a heavy reasoning run. Return structured output only.",
      "",
      `Depth: ${depth}`,
      `Task: ${task.title}`,
      `Goal: ${task.goal}`,
      `Deliverable: ${task.deliverable}`,
      "",
      task.prompt,
      "",
      "Use the details field for the full explanation. Keep findings and next_steps concise.",
    ].join("\n")
  }

  function synthPrompt(input: {
    query: string
    plan: HeavySchema.Plan
    results: HeavySchema.Result[]
    depth: number
  }) {
    return [
      "You are synthesizing a heavy reasoning run. Return structured output only.",
      "",
      `Depth: ${input.depth}`,
      `User query:\n${input.query}`,
      "",
      "Plan:",
      JSON.stringify(input.plan, null, 2),
      "",
      "Task results:",
      JSON.stringify(input.results, null, 2),
      "",
      "Write a direct final answer, a short summary, key points, next steps, and open questions.",
    ].join("\n")
  }

  function uniq(items: string[]) {
    return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))
  }

  function preview(result: HeavySchema.Result) {
    return (result.summary || result.details || result.findings[0] || "").slice(0, 220)
  }

  function normalize(input: { results: HeavySchema.Result[]; synth: HeavySchema.Synthesis }) {
    return HeavySchema.Synthesis.parse({
      ...input.synth,
      summary: input.synth.summary.trim() || uniq(input.results.map((item) => item.summary)).slice(0, 2).join("\n\n"),
      answer: input.synth.answer.trim() || input.synth.summary.trim() || "No answer captured.",
      key_points: input.synth.key_points.length
        ? uniq(input.synth.key_points)
        : uniq(input.results.flatMap((item) => item.findings)).slice(0, 8),
      next_steps: input.synth.next_steps.length
        ? uniq(input.synth.next_steps)
        : uniq(input.results.flatMap((item) => item.next_steps)).slice(0, 6),
      open_questions: input.synth.open_questions.length
        ? uniq(input.synth.open_questions)
        : uniq(
            input.results
              .flatMap((item) => item.details.split("\n"))
              .filter((line) => line.trim().endsWith("?")),
          ).slice(0, 6),
    })
  }

  function update(input: {
    ctx: Tool.Context
    stage: string
    dir: string
    depth: number
    plan?: HeavySchema.Plan
    tasks?: State[]
  }) {
    return input.ctx.metadata({
      title: "Heavy analysis",
      metadata: {
        stage: input.stage,
        dir: input.dir,
        depth: input.depth,
        plan: input.plan
          ? {
              summary: input.plan.summary,
              synthesisFocus: input.plan.synthesis_focus,
            }
          : undefined,
        tasks: input.tasks,
      },
    })
  }

  function write(input: { dir: string; task: HeavySchema.Plan["tasks"][number]; result: HeavySchema.Result }) {
    return Effect.gen(function* () {
      const id = HeavyArtifact.task(input.task.id || input.task.title)
      const json = `${input.dir}/tasks/${id}.json`
      const md = `${input.dir}/tasks/${id}.md`
      yield* HeavyArtifact.json(json, { task: input.task, result: input.result })
      yield* Effect.promise(() =>
        Bun.write(
          md,
          [
            `# ${input.result.title}`,
            "",
            input.result.summary,
            ...(input.result.details ? ["", input.result.details] : []),
            "",
            "## Findings",
            (input.result.findings.length ? input.result.findings : ["None recorded"])
              .map((item) => `- ${item}`)
              .join("\n"),
            "",
            "## Next Steps",
            (input.result.next_steps.length ? input.result.next_steps : ["None recorded"])
              .map((item) => `- ${item}`)
              .join("\n"),
            ...(input.result.nested
              ? [
                  "",
                  "## Nested Run",
                  `- Depth: ${input.result.nested.depth}`,
                  `- Report: ${input.result.nested.report}`,
                  `- Artifacts: ${input.result.nested.dir}`,
                ]
              : []),
            "",
          ].join("\n"),
        ),
      )
      return { json, md }
    })
  }

  function direct(input: {
    ctx: Tool.Context
    base: Base
    dir: string
    plan: HeavySchema.Plan
    states: State[]
    task: HeavySchema.Plan["tasks"][number]
    state: State
    depth: number
  }) {
    return Effect.gen(function* () {
      const msg = yield* run({
        ctx: input.ctx,
        base: input.base,
        agent: input.task.agent,
        title: `Heavy: ${input.task.title}`,
        prompt: taskPrompt(input.task, input.depth),
        format: HeavySchema.Result,
        onStart(sessionID) {
          input.state.sessionID = sessionID
          return update({
            ctx: input.ctx,
            stage: "executing",
            dir: input.dir,
            depth: input.depth,
            plan: input.plan,
            tasks: input.states,
          })
        },
      })
      const result = parse(msg.message, HeavySchema.Result)
      const file = yield* write({
        dir: input.dir,
        task: input.task,
        result,
      })
      return {
        task: input.task,
        result,
        ...file,
      }
    })
  }

  function nested(input: {
    ctx: Tool.Context
    base: Base
    root: string
    task: HeavySchema.Plan["tasks"][number]
    depth: number
    max: number
  }): Effect.Effect<HeavySchema.Result, unknown, unknown> {
    return Effect.gen(function* () {
      const dir = yield* HeavyArtifact.child(input.root, input.task.id || input.task.title)
      const out = yield* flow({
        ctx: {
          ...input.ctx,
          metadata() {
            return Effect.void
          },
        },
        base: input.base,
        dir,
        input: {
          query: input.task.prompt,
          context: [
            `Parent task: ${input.task.title}`,
            `Goal: ${input.task.goal}`,
            `Deliverable: ${input.task.deliverable}`,
          ],
          depth: input.depth + 1,
          max_depth: input.max,
        },
      })
      return HeavySchema.Result.parse({
        task_id: input.task.id,
        title: input.task.title,
        summary: out.synth.summary,
        details: [out.synth.answer, "", `Nested report: ${out.reportPath}`].join("\n"),
        findings: out.synth.key_points,
        next_steps: out.synth.next_steps,
        nested: {
          depth: input.depth + 1,
          dir: out.dir,
          report: out.reportPath,
        },
      })
    })
  }

  function exec(input: {
    ctx: Tool.Context
    base: Base
    dir: string
    plan: HeavySchema.Plan
    states: State[]
    task: HeavySchema.Plan["tasks"][number]
    state: State
    depth: number
    max: number
  }): Effect.Effect<Task, unknown, unknown> {
    if (input.task.mode !== "heavy" || input.depth >= input.max) {
      return direct(input)
    }

    input.state.preview = `Nested heavy run at depth ${input.depth + 1}`
    return Effect.gen(function* () {
      yield* update({
        ctx: input.ctx,
        stage: "executing",
        dir: input.dir,
        depth: input.depth,
        plan: input.plan,
        tasks: input.states,
      })
      const result = yield* nested({
        ctx: input.ctx,
        base: input.base,
        root: input.dir,
        task: input.task,
        depth: input.depth,
        max: input.max,
      })
      input.state.reportPath = result.nested?.report ?? ""
      const file = yield* write({
        dir: input.dir,
        task: input.task,
        result,
      })
      return {
        task: input.task,
        result,
        ...file,
      }
    })
  }

  function flow(input: { ctx: Tool.Context; base: Base; dir: string; input: Input }): Effect.Effect<Run, unknown, unknown> {
    return Effect.gen(function* () {
      const requestPath = `${input.dir}/request.json`
      const planPath = `${input.dir}/plan.json`
      const synthesisPath = `${input.dir}/synthesis.json`
      const reportPath = `${input.dir}/HEAVY_REPORT.md`
      const reportHtmlPath = `${input.dir}/HEAVY_REPORT.html`
      yield* HeavyArtifact.json(requestPath, input.input)

      yield* update({
        ctx: input.ctx,
        stage: "planning",
        dir: input.dir,
        depth: input.input.depth,
      })

      const planMsg = yield* run({
        ctx: input.ctx,
        base: input.base,
        agent: "general",
        title: `Heavy planning (${input.input.depth})`,
        prompt: planPrompt(input.input),
        format: HeavySchema.Plan,
      })
      const plan = parse(planMsg.message, HeavySchema.Plan)
      yield* HeavyArtifact.json(planPath, plan)

      const states: State[] = plan.tasks.map((item) => ({
        id: item.id,
        title: item.title,
        mode: item.mode,
        agent: item.agent,
        goal: item.goal,
        deliverable: item.deliverable,
        depth: input.input.depth,
        status: "pending",
        sessionID: "",
        preview: "",
        reportPath: "",
      }))
      yield* update({
        ctx: input.ctx,
        stage: "executing",
        dir: input.dir,
        depth: input.input.depth,
        plan,
        tasks: states,
      })

      const tasks = yield* Effect.forEach(
        plan.tasks,
        (item, index) =>
          Effect.gen(function* () {
            const state = states[index]
            state.status = "running"
            yield* update({
              ctx: input.ctx,
              stage: "executing",
              dir: input.dir,
              depth: input.input.depth,
              plan,
              tasks: states,
            })
            const out = yield* exec({
              ctx: input.ctx,
              base: input.base,
              dir: input.dir,
              plan,
              states,
              task: item,
              state,
              depth: input.input.depth,
              max: input.input.max_depth,
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.gen(function* () {
                  state.status = "error"
                  state.preview = text(cause)
                  yield* update({
                    ctx: input.ctx,
                    stage: "executing",
                    dir: input.dir,
                    depth: input.input.depth,
                    plan,
                    tasks: states,
                  })
                  return yield* Effect.failCause(cause)
                }),
              ),
            )
            state.status = "completed"
            state.preview = preview(out.result)
            state.reportPath = out.result.nested?.report ?? state.reportPath
            yield* update({
              ctx: input.ctx,
              stage: "executing",
              dir: input.dir,
              depth: input.input.depth,
              plan,
              tasks: states,
            })
            return out
          }),
        { concurrency: "unbounded" },
      )

      yield* update({
        ctx: input.ctx,
        stage: "synthesizing",
        dir: input.dir,
        depth: input.input.depth,
        plan,
        tasks: states,
      })
      const synthMsg = yield* run({
        ctx: input.ctx,
        base: input.base,
        agent: "general",
        title: `Heavy synthesis (${input.input.depth})`,
        prompt: synthPrompt({
          query: input.input.query,
          plan,
          results: tasks.map((item) => item.result),
          depth: input.input.depth,
        }),
        format: HeavySchema.Synthesis,
      })
      const synth = normalize({
        results: tasks.map((item) => item.result),
        synth: parse(synthMsg.message, HeavySchema.Synthesis),
      })
      yield* HeavyArtifact.json(synthesisPath, synth)

      const paths = HeavySchema.Paths.parse({
        root: input.dir,
        request: requestPath,
        plan: planPath,
        tasks: tasks.map((item) => item.json),
        synthesis: synthesisPath,
        report: reportPath,
        report_html: reportHtmlPath,
        nested: tasks.flatMap((item) => (item.result.nested ? [item.result.nested.dir] : [])),
      })
      yield* HeavyArtifact.json(`${input.dir}/paths.json`, paths)

      const report = HeavyReport.render({
        query: input.input.query,
        plan,
        tasks,
        synth,
      })
      yield* Effect.promise(() => Bun.write(reportPath, report))
      yield* Effect.promise(() =>
        Bun.write(
          reportHtmlPath,
          RunHtml.heavy({
            dir: input.dir,
            query: input.input.query,
            plan,
            tasks,
            synth,
            report,
            reportPath,
            reportHtmlPath,
          }),
        ),
      )

      yield* update({
        ctx: input.ctx,
        stage: "completed",
        dir: input.dir,
        depth: input.input.depth,
        plan,
        tasks: states,
      })

      return {
        dir: input.dir,
        reportPath,
        reportHtmlPath,
        paths,
        plan,
        states,
        tasks,
        synth,
      }
    })
  }

  export function execute(input: { input: Input; ctx: Tool.Context }): Effect.Effect<Run, unknown, unknown> {
    return Effect.gen(function* () {
      const cfg = Input.parse(input.input)
      yield* input.ctx.ask({
        permission: "heavy_run",
        patterns: [cfg.query.slice(0, 120)],
        always: ["*"],
        metadata: {
          query: cfg.query,
          maxDepth: cfg.max_depth,
        },
      })

      const base = yield* model(input.ctx)
      const dir = yield* HeavyArtifact.init({
        sessionID: input.ctx.sessionID,
        messageID: input.ctx.messageID,
      })
      return yield* flow({
        ctx: input.ctx,
        base,
        dir,
        input: cfg,
      })
    })
  }
}
