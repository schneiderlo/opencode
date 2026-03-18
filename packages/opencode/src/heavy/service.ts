import { Agent } from "../agent/agent"
import { Config } from "../config/config"
import { HeavyArtifact } from "./artifact"
import { HeavyReport } from "./report"
import { HeavySchema } from "./schema"
import { defer } from "@/util/defer"
import { MessageV2 } from "../session/message-v2"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { MessageID } from "../session/schema"
import type { Tool } from "../tool/tool"
import z from "zod"

const params = z.object({
  query: z.string(),
  context: z.array(z.string()).default([]),
})

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

  function schema(input: z.ZodType) {
    return z.toJSONSchema(input) as Record<string, any>
  }

  async function model(ctx: Tool.Context) {
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
    model: Awaited<ReturnType<typeof model>>["model"]
    agent: "explore" | "general"
    title: string
    prompt: string
    format: z.ZodType
    onStart?: (sessionID: string) => void
  }) {
    const agent = await Agent.get(input.agent)
    if (!agent) throw new Error(`Agent not found: ${input.agent}`)

    const config = await Config.get()
    const session = await Session.create({
      parentID: input.ctx.sessionID,
      title: input.title,
      permission: [
        ...rules,
        ...(config.experimental?.primary_tools?.map((item) => ({
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
      model: input.model,
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
      "Break the request into 2-6 independent tasks.",
      "Use explore for codebase search/navigation tasks.",
      "Use general for reasoning, implementation, or synthesis-heavy tasks.",
      "Each task prompt should be self-contained and specific.",
      "",
      `User query:\n${input.query}`,
      ...(input.context.length ? ["", `Explicit context:\n${input.context.map((item) => `- ${item}`).join("\n")}`] : []),
    ].join("\n")
  }

  function taskPrompt(task: HeavySchema.Plan["tasks"][number]) {
    return [
      "You are executing one task from a heavy reasoning run. Return structured output only.",
      "",
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
    results: Array<HeavySchema.Result>
  }) {
    return [
      "You are synthesizing a heavy reasoning run. Return structured output only.",
      "",
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

  function normalize(input: { results: Array<HeavySchema.Result>; synth: HeavySchema.Synthesis }) {
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

  export async function execute(input: { input: Input; ctx: Tool.Context }) {
    await input.ctx.ask({
      permission: "heavy_run",
      patterns: [input.input.query.slice(0, 120)],
      always: ["*"],
      metadata: {
        query: input.input.query,
      },
    })

    const base = await model(input.ctx)
    const dir = await HeavyArtifact.init({
      sessionID: input.ctx.sessionID,
      messageID: input.ctx.messageID,
    })
    const requestPath = `${dir}/request.json`
    const planPath = `${dir}/plan.json`
    const synthesisPath = `${dir}/synthesis.json`
    const reportPath = `${dir}/HEAVY_REPORT.md`
    await HeavyArtifact.json(requestPath, input.input)

    input.ctx.metadata({
      title: "Heavy analysis",
      metadata: {
        stage: "planning",
        dir,
      },
    })

    const planMsg = await run({
      ctx: input.ctx,
      model: base.model,
      agent: "general",
      title: "Heavy planning",
      prompt: planPrompt(input.input),
      format: HeavySchema.Plan,
    })
    const plan = parse(planMsg.message, HeavySchema.Plan)
    await HeavyArtifact.json(planPath, plan)

    const tracker = plan.tasks.map((item) => ({
      id: item.id,
      title: item.title,
      agent: item.agent,
      status: "pending" as "pending" | "running" | "completed" | "error",
      sessionID: "",
      preview: "",
    }))
    const update = (stage: string) =>
      input.ctx.metadata({
        title: "Heavy analysis",
        metadata: {
          stage,
          dir,
          tasks: tracker,
        },
      })

    update("executing")

    const tasks = await Promise.all(
      plan.tasks.map(async (task, index) => {
        const state = tracker[index]
        state.status = "running"
        update("executing")
        try {
          const msg = await run({
            ctx: input.ctx,
            model: base.model,
            agent: task.agent,
            title: `Heavy: ${task.title}`,
            prompt: taskPrompt(task),
            format: HeavySchema.Result,
            onStart(sessionID) {
              state.sessionID = sessionID
              update("executing")
            },
          })
          const result = parse(msg.message, HeavySchema.Result)
          state.status = "completed"
          state.preview = (result.summary || result.details || result.findings[0] || "").slice(0, 220)
          update("executing")
          const id = HeavyArtifact.task(task.id || task.title)
          const json = `${dir}/tasks/${id}.json`
          const md = `${dir}/tasks/${id}.md`
          await HeavyArtifact.json(json, { task, result })
          await Bun.write(
            md,
            [
              `# ${result.title}`,
              "",
              result.summary,
              ...(result.details ? ["", result.details] : []),
              "",
              "## Findings",
              (result.findings.length ? result.findings : ["None recorded"]).map((item) => `- ${item}`).join("\n"),
              "",
              "## Next Steps",
              (result.next_steps.length ? result.next_steps : ["None recorded"]).map((item) => `- ${item}`).join("\n"),
              "",
            ].join("\n"),
          )
          return { task, result, json, md }
        } catch (error: any) {
          state.status = "error"
          state.preview = error?.message ?? String(error)
          update("executing")
          throw error
        }
      }),
    )

    update("synthesizing")
    const synthMsg = await run({
      ctx: input.ctx,
      model: base.model,
      agent: "general",
      title: "Heavy synthesis",
      prompt: synthPrompt({
        query: input.input.query,
        plan,
        results: tasks.map((item) => item.result),
      }),
      format: HeavySchema.Synthesis,
    })
    const synth = normalize({
      results: tasks.map((item) => item.result),
      synth: parse(synthMsg.message, HeavySchema.Synthesis),
    })
    await HeavyArtifact.json(synthesisPath, synth)

    const paths = HeavySchema.Paths.parse({
      root: dir,
      request: requestPath,
      plan: planPath,
      tasks: tasks.map((item) => item.json),
      synthesis: synthesisPath,
    })
    await HeavyArtifact.json(`${dir}/paths.json`, paths)

    await Bun.write(
      reportPath,
      HeavyReport.render({
        query: input.input.query,
        plan,
        tasks,
        synth,
      }),
    )

    input.ctx.metadata({
      title: "Heavy analysis",
      metadata: {
        stage: "completed",
        dir,
        tasks: tracker,
      },
    })

    return {
      dir,
      reportPath,
      paths,
      plan,
      tasks,
      synth,
    }
  }
}
