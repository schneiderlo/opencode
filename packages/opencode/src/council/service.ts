import { Agent } from "../agent/agent"
import { Config } from "../config/config"
import { CouncilArtifact } from "./artifact"
import { CouncilReport } from "./report"
import { CouncilSchema } from "./schema"
import { defer } from "@/util/defer"
import { DebateTool } from "../tool/debate"
import { MessageV2 } from "../session/message-v2"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { MessageID } from "../session/schema"
import type { Tool } from "../tool/tool"
import z from "zod"

const params = z.object({
  query: z.string(),
  context: z.array(z.string()).default([]),
  include_debate: z.boolean().default(true),
})

export namespace CouncilService {
  export const Input = params
  export type Input = z.infer<typeof Input>

  const rules = [
    { permission: "todowrite", pattern: "*", action: "deny" as const },
    { permission: "todoread", pattern: "*", action: "deny" as const },
    { permission: "task", pattern: "*", action: "deny" as const },
    { permission: "map_reduce", pattern: "*", action: "deny" as const },
    { permission: "debate", pattern: "*", action: "deny" as const },
    { permission: "council_run", pattern: "*", action: "deny" as const },
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
    title: string
    prompt: string
    format: z.ZodType
  }) {
    const agent = await Agent.get("general")
    if (!agent) throw new Error("General agent not found")

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

    const messageID = MessageID.ascending()
    function cancel() {
      SessionPrompt.cancel(session.id)
    }
    input.ctx.abort.addEventListener("abort", cancel)
    using _ = defer(() => input.ctx.abort.removeEventListener("abort", cancel))

    return await SessionPrompt.prompt({
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
        debate: false,
        council_run: false,
      },
      format: {
        type: "json_schema",
        schema: schema(input.format),
        retryCount: 1,
      },
      parts: await SessionPrompt.resolvePromptParts(input.prompt),
    })
  }

  function planPrompt(input: Input) {
    return [
      "You are planning a Council analysis. Return structured output only.",
      "",
      "Pick 2-4 perspectives that create useful tension without redundancy.",
      "Only include debate_topics when there is a real chance of disagreement that would change the final recommendation.",
      "Keep shared_context concise and factual.",
      "",
      `User query:\n${input.query}`,
      ...(input.context.length ? ["", `Explicit context:\n${input.context.map((item) => `- ${item}`).join("\n")}`] : []),
    ].join("\n")
  }

  function taskPrompt(task: CouncilSchema.Task) {
    return [
      "You are contributing one perspective to a Council analysis. Return structured output only.",
      "",
      `Topic: ${task.topic}`,
      `Summary: ${task.summary}`,
      "",
      "Perspective:",
      JSON.stringify(task.persona, null, 2),
      "",
      "Shared context:",
      JSON.stringify(task.shared_context, null, 2),
      "",
      "Required sections:",
      JSON.stringify(task.required_sections, null, 2),
      "",
      `User query:\n${task.user_query}`,
      "",
      "Answer from this perspective only. Make the findings concrete and non-duplicative.",
    ].join("\n")
  }

  function synthPrompt(input: {
    query: string
    plan: CouncilSchema.Plan
    results: Array<CouncilSchema.Result>
    debates: Array<CouncilSchema.Debate>
  }) {
    return [
      "You are synthesizing a completed Council run. Return structured output only.",
      "",
      `User query:\n${input.query}`,
      "",
      "Plan:",
      JSON.stringify(input.plan, null, 2),
      "",
      "Perspective results:",
      JSON.stringify(input.results, null, 2),
      "",
      "Debates:",
      JSON.stringify(input.debates, null, 2),
      "",
      "Produce a final recommendation, rationale, agreements, disagreements, tradeoffs, next steps, and open questions.",
    ].join("\n")
  }

  function debatePairs(input: { plan: CouncilSchema.Plan; results: Array<CouncilSchema.Result> }) {
    return input.plan.debate_topics
      .map((topic) => ({
        topic,
        perspectives: input.results
          .filter((item) =>
            item.findings.some((line) => line.toLowerCase().includes(topic.toLowerCase())) ||
            item.recommendations.some((line) => line.toLowerCase().includes(topic.toLowerCase())),
          )
          .slice(0, 3)
          .map((item) => ({
            name: item.perspective,
            position: [item.executive_summary, ...item.recommendations].join("\n"),
          })),
      }))
      .filter((item) => item.perspectives.length >= 2)
  }

  function parse<T>(msg: MessageV2.WithParts, shape: z.ZodType<T>) {
    if (msg.info.role !== "assistant") throw new Error("Expected assistant message")
    return shape.parse(msg.info.structured)
  }

  export async function execute(input: { input: Input; ctx: Tool.Context }) {
    await input.ctx.ask({
      permission: "council_run",
      patterns: [input.input.query.slice(0, 120)],
      always: ["*"],
      metadata: {
        query: input.input.query,
        includeDebate: input.input.include_debate,
      },
    })

    const base = await model(input.ctx)
    const dir = await CouncilArtifact.init({
      sessionID: input.ctx.sessionID,
      messageID: input.ctx.messageID,
    })

    input.ctx.metadata({
      title: "Council analysis",
      metadata: {
        stage: "planning",
        dir,
      },
    })

    await CouncilArtifact.json(`${dir}/request.json`, input.input)

    const planMsg = await run({
      ctx: input.ctx,
      model: base.model,
      title: "Council planning",
      prompt: planPrompt(input.input),
      format: CouncilSchema.Plan,
    })
    const plan = parse(planMsg, CouncilSchema.Plan)
    await CouncilArtifact.json(`${dir}/plan.json`, plan)

    input.ctx.metadata({
      title: "Council analysis",
      metadata: {
        stage: "consulting",
        dir,
        perspectives: plan.perspectives.map((item) => item.name),
      },
    })

    const results = await Promise.all(
      plan.perspectives.map(async (persona) => {
        const task = CouncilSchema.Task.parse({
          topic: plan.topic,
          summary: plan.summary,
          user_query: input.input.query,
          shared_context: [...input.input.context, ...plan.shared_context],
          persona,
          required_sections: [
            "executive_summary",
            "findings",
            "recommendations",
            "tradeoffs",
            "unknowns",
          ],
        })
        const msg = await run({
          ctx: input.ctx,
          model: base.model,
          title: `Council: ${persona.name}`,
          prompt: taskPrompt(task),
          format: CouncilSchema.Result,
        })
        const result = parse(msg, CouncilSchema.Result)
        const id = CouncilArtifact.perspective(persona.id || persona.name)
        const json = `${dir}/perspectives/${id}.json`
        const md = `${dir}/perspectives/${id}.md`
        await CouncilArtifact.json(json, { task, result })
        await Bun.write(
          md,
          [
            `# ${result.perspective}`,
            "",
            result.executive_summary,
            "",
            "## Findings",
            result.findings.map((item) => `- ${item}`).join("\n"),
            "",
            "## Recommendations",
            result.recommendations.map((item) => `- ${item}`).join("\n"),
            "",
            "## Tradeoffs",
            (result.tradeoffs.length ? result.tradeoffs : ["None recorded"]).map((item) => `- ${item}`).join("\n"),
            "",
            "## Unknowns",
            (result.unknowns.length ? result.unknowns : ["None recorded"]).map((item) => `- ${item}`).join("\n"),
            "",
          ].join("\n"),
        )
        return { task, result, json, md }
      }),
    )

    const debates = [] as Array<CouncilSchema.Debate & { json: string; md?: string }>
    const pairs = input.input.include_debate ? debatePairs({ plan, results: results.map((item) => item.result) }) : []
    if (pairs.length) {
      input.ctx.metadata({
        title: "Council analysis",
        metadata: {
          stage: "debating",
          dir,
          debates: pairs.map((item) => item.topic),
        },
      })
    }

    for (const item of pairs) {
      const tool = await DebateTool.init()
      const out = await tool.execute(
        {
          topic: item.topic,
          perspectives: item.perspectives,
          rounds: 1,
        },
        {
          ...input.ctx,
          ask: async () => {},
          metadata: () => {},
        },
      )
      const debate = CouncilSchema.Debate.parse({
        topic: item.topic,
        summary: out.output,
        agreements: [],
        disagreements: item.perspectives.map((entry) => entry.name),
        transcript_path: out.metadata.transcriptPath,
      })
      const id = CouncilArtifact.debate(item.topic)
      const json = `${dir}/debates/${id}.json`
      const md = `${dir}/debates/${id}.md`
      await CouncilArtifact.json(json, debate)
      if (out.metadata.transcriptPath) {
        const file = Bun.file(out.metadata.transcriptPath)
        if (await file.exists()) await Bun.write(md, await file.text())
      }
      debates.push({ ...debate, json, md: await Bun.file(md).exists() ? md : undefined })
    }

    input.ctx.metadata({
      title: "Council analysis",
      metadata: {
        stage: "synthesizing",
        dir,
      },
    })

    const synthMsg = await run({
      ctx: input.ctx,
      model: base.model,
      title: "Council synthesis",
      prompt: synthPrompt({
        query: input.input.query,
        plan,
        results: results.map((item) => item.result),
        debates,
      }),
      format: CouncilSchema.Synthesis,
    })
    const synth = parse(synthMsg, CouncilSchema.Synthesis)
    await CouncilArtifact.json(`${dir}/synthesis.json`, synth)

    const report = CouncilReport.render({
      query: input.input.query,
      plan,
      results,
      debates,
      synth,
    })
    const reportPath = `${dir}/COUNCIL_REPORT.md`
    await Bun.write(reportPath, report)

    return {
      dir,
      reportPath,
      plan,
      results,
      debates,
      synth,
    }
  }
}
