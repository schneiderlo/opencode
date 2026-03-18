import { Agent } from "../agent/agent"
import { Config } from "../config/config"
import { MessageV2 } from "../session/message-v2"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { MessageID } from "../session/schema"
import type { Tool } from "../tool/tool"
import { HeavyArtifact } from "./artifact"
import { HeavyReport } from "./report"
import { HeavySchema } from "./schema"
import { defer } from "@/util/defer"
import z from "zod"

const params = HeavySchema.Input

type Base = {
  model: {
    modelID: string
    providerID: string
  }
}

type State = {
  id: string
  title: string
  mode: "direct" | "heavy"
  agent: "explore" | "general"
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
  paths: HeavySchema.Paths
  plan: HeavySchema.Plan
  tasks: Task[]
  synth: HeavySchema.Synthesis
}

export namespace HeavyService {
  export const Input = params
  export type Input = z.infer<typeof Input>

  const rules = [
    { permission: "todowrite", pattern: "*", action: "deny" as const },
    { permission: "todoread", pattern: "*", action: "deny" as const },
    { permission: "task", pattern: "*", action: "deny" as const },
    { permission: "map_reduce", pattern: "*", action: "deny" as const },
    { permission: "heavy_run", pattern: "*", action: "deny" as const },
    { permission: "edit", pattern: "*", action: "deny" as const },
    { permission: "write", pattern: "*", action: "deny" as const },
    { permission: "apply_patch", pattern: "*", action: "deny" as const },
    { permission: "bash", pattern: "*", action: "deny" as const },
  ]

  function json(input: z.ZodType) {
    return z.toJSONSchema(input) as Record<string, any>
  }

  async function model(ctx: Tool.Context): Promise<Base> {
    const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
    if (msg.info.role !== "assistant") throw new Error("Not an assistant message")
    return {
      model: {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      },
    }
  }

  async function run(input: {
    ctx: Tool.Context
    base: Base
    agent: "explore" | "general"
    title: string
    prompt: string
    format: z.ZodType
    onStart?: (sessionID: string) => void
  }) {
    const agent = await Agent.get(input.agent)
    if (!agent) throw new Error(`Agent not found: ${input.agent}`)

    const cfg = await Config.get()
    const session = await Session.create({
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
    input.onStart?.(session.id)

    const messageID = MessageID.ascending()
    function cancel() {
      SessionPrompt.cancel(session.id)
    }
    input.ctx.abort.addEventListener("abort", cancel)
    using _ = defer(() => input.ctx.abort.removeEventListener("abort", cancel))

    const msg = await SessionPrompt.prompt({
      messageID,
      sessionID: session.id,
      model: input.base.model as any,
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
        schema: json(input.format),
        retryCount: 1,
      },
      parts: await SessionPrompt.resolvePromptParts(input.prompt),
    })
    return {
      sessionID: session.id,
      message: msg,
    }
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
    tasks?: State[]
  }) {
    input.ctx.metadata({
      title: "Heavy analysis",
      metadata: {
        stage: input.stage,
        dir: input.dir,
        depth: input.depth,
        tasks: input.tasks,
      },
    })
  }

  async function write(input: { dir: string; task: HeavySchema.Plan["tasks"][number]; result: HeavySchema.Result }) {
    const id = HeavyArtifact.task(input.task.id || input.task.title)
    const json = `${input.dir}/tasks/${id}.json`
    const md = `${input.dir}/tasks/${id}.md`
    await HeavyArtifact.json(json, { task: input.task, result: input.result })
    await Bun.write(
      md,
      [
        `# ${input.result.title}`,
        "",
        input.result.summary,
        ...(input.result.details ? ["", input.result.details] : []),
        "",
        "## Findings",
        (input.result.findings.length ? input.result.findings : ["None recorded"]).map((item) => `- ${item}`).join("\n"),
        "",
        "## Next Steps",
        (input.result.next_steps.length ? input.result.next_steps : ["None recorded"]).map((item) => `- ${item}`).join("\n"),
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
    )
    return { json, md }
  }

  async function direct(input: {
    ctx: Tool.Context
    base: Base
    dir: string
    task: HeavySchema.Plan["tasks"][number]
    state: State
    depth: number
  }) {
    const msg = await run({
      ctx: input.ctx,
      base: input.base,
      agent: input.task.agent,
      title: `Heavy: ${input.task.title}`,
      prompt: taskPrompt(input.task, input.depth),
      format: HeavySchema.Result,
      onStart(sessionID) {
        input.state.sessionID = sessionID
        update({
          ctx: input.ctx,
          stage: "executing",
          dir: input.dir,
          depth: input.depth,
        })
      },
    })
    const result = parse(msg.message, HeavySchema.Result)
    const file = await write({
      dir: input.dir,
      task: input.task,
      result,
    })
    return {
      task: input.task,
      result,
      ...file,
    }
  }

  async function nested(input: {
    ctx: Tool.Context
    base: Base
    root: string
    task: HeavySchema.Plan["tasks"][number]
    depth: number
    max: number
  }) {
    const dir = await HeavyArtifact.child(input.root, input.task.id || input.task.title)
    const out = await flow({
      ctx: input.ctx,
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
  }

  async function exec(input: {
    ctx: Tool.Context
    base: Base
    dir: string
    task: HeavySchema.Plan["tasks"][number]
    state: State
    depth: number
    max: number
  }) {
    if (input.task.mode !== "heavy" || input.depth >= input.max) {
      return direct(input)
    }

    input.state.preview = `Nested heavy run at depth ${input.depth + 1}`
    update({
      ctx: input.ctx,
      stage: "executing",
      dir: input.dir,
      depth: input.depth,
    })
    const result = await nested({
      ctx: input.ctx,
      base: input.base,
      root: input.dir,
      task: input.task,
      depth: input.depth,
      max: input.max,
    })
    input.state.reportPath = result.nested?.report ?? ""
    const file = await write({
      dir: input.dir,
      task: input.task,
      result,
    })
    return {
      task: input.task,
      result,
      ...file,
    }
  }

  async function flow(input: { ctx: Tool.Context; base: Base; dir: string; input: Input }): Promise<Run> {
    const requestPath = `${input.dir}/request.json`
    const planPath = `${input.dir}/plan.json`
    const synthesisPath = `${input.dir}/synthesis.json`
    const reportPath = `${input.dir}/HEAVY_REPORT.md`
    await HeavyArtifact.json(requestPath, input.input)

    update({
      ctx: input.ctx,
      stage: "planning",
      dir: input.dir,
      depth: input.input.depth,
    })

    const planMsg = await run({
      ctx: input.ctx,
      base: input.base,
      agent: "general",
      title: `Heavy planning (${input.input.depth})`,
      prompt: planPrompt(input.input),
      format: HeavySchema.Plan,
    })
    const plan = parse(planMsg.message, HeavySchema.Plan)
    await HeavyArtifact.json(planPath, plan)

    const states: State[] = plan.tasks.map((item) => ({
      id: item.id,
      title: item.title,
      mode: item.mode,
      agent: item.agent,
      depth: input.input.depth,
      status: "pending",
      sessionID: "",
      preview: "",
      reportPath: "",
    }))
    update({
      ctx: input.ctx,
      stage: "executing",
      dir: input.dir,
      depth: input.input.depth,
      tasks: states,
    })

    const tasks: Task[] = await Promise.all(
      plan.tasks.map(async (item, i) => {
        const state = states[i]
        state.status = "running"
        update({
          ctx: input.ctx,
          stage: "executing",
          dir: input.dir,
          depth: input.input.depth,
          tasks: states,
        })
        try {
          const out = await exec({
            ctx: input.ctx,
            base: input.base,
            dir: input.dir,
            task: item,
            state,
            depth: input.input.depth,
            max: input.input.max_depth,
          })
          state.status = "completed"
          state.preview = preview(out.result)
          state.reportPath = out.result.nested?.report ?? state.reportPath
          update({
            ctx: input.ctx,
            stage: "executing",
            dir: input.dir,
            depth: input.input.depth,
            tasks: states,
          })
          return out
        } catch (err: any) {
          state.status = "error"
          state.preview = err?.message ?? String(err)
          update({
            ctx: input.ctx,
            stage: "executing",
            dir: input.dir,
            depth: input.input.depth,
            tasks: states,
          })
          throw err
        }
      }),
    )

    update({
      ctx: input.ctx,
      stage: "synthesizing",
      dir: input.dir,
      depth: input.input.depth,
      tasks: states,
    })
    const synthMsg = await run({
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
    await HeavyArtifact.json(synthesisPath, synth)

    const paths = HeavySchema.Paths.parse({
      root: input.dir,
      request: requestPath,
      plan: planPath,
      tasks: tasks.map((item) => item.json),
      synthesis: synthesisPath,
      nested: tasks.flatMap((item) => (item.result.nested ? [item.result.nested.dir] : [])),
    })
    await HeavyArtifact.json(`${input.dir}/paths.json`, paths)

    await Bun.write(
      reportPath,
      HeavyReport.render({
        query: input.input.query,
        plan,
        tasks,
        synth,
      }),
    )

    update({
      ctx: input.ctx,
      stage: "completed",
      dir: input.dir,
      depth: input.input.depth,
      tasks: states,
    })

    return {
      dir: input.dir,
      reportPath,
      paths,
      plan,
      tasks,
      synth,
    }
  }

  export async function execute(input: { input: Input; ctx: Tool.Context }) {
    const cfg = Input.parse(input.input)
    await input.ctx.ask({
      permission: "heavy_run",
      patterns: [cfg.query.slice(0, 120)],
      always: ["*"],
      metadata: {
        query: cfg.query,
        maxDepth: cfg.max_depth,
      },
    })

    const base = await model(input.ctx)
    const dir = await HeavyArtifact.init({
      sessionID: input.ctx.sessionID,
      messageID: input.ctx.messageID,
    })
    return flow({
      ctx: input.ctx,
      base,
      dir,
      input: cfg,
    })
  }
}
