import { Agent } from "../agent/agent"
import { Config } from "../config/config"
import { CouncilArtifact } from "./artifact"
import { CouncilDebate } from "./debate"
import { CouncilReport } from "./report"
import { CouncilSchema } from "./schema"
import { RunHtml } from "../report/html"
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
    onStart?: (sessionID: string) => void
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
    input.onStart?.(session.id)

    const messageID = MessageID.ascending()
    function cancel() {
      SessionPrompt.cancel(session.id)
    }
    input.ctx.abort.addEventListener("abort", cancel)
    using _ = defer(() => input.ctx.abort.removeEventListener("abort", cancel))

    const message = await SessionPrompt.prompt({
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
    return {
      sessionID: session.id,
      message,
    }
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
      "Use the analysis field for a detailed, substantive explanation in multiple paragraphs.",
      "Make the findings concrete and non-duplicative.",
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
      "Produce an executive_summary and decision_log with real detail.",
      "Produce a final recommendation, rationale, agreements, disagreements, tradeoffs, next steps, and open questions.",
    ].join("\n")
  }

  function parse<T>(msg: MessageV2.WithParts, shape: z.ZodType<T>) {
    if (msg.info.role !== "assistant") throw new Error("Expected assistant message")
    return shape.parse(msg.info.structured)
  }

  function uniq(items: string[]) {
    return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))
  }

  function recurring(input: Array<{ findings: string[]; recommendations: string[] }>) {
    const count = new Map<string, number>()
    for (const line of input.flatMap((item) => [...item.findings, ...item.recommendations])) {
      const key = line.trim().toLowerCase()
      if (!key) continue
      count.set(key, (count.get(key) ?? 0) + 1)
    }

    return uniq(
      input
        .flatMap((item) => [...item.findings, ...item.recommendations])
        .filter((line) => (count.get(line.trim().toLowerCase()) ?? 0) > 1),
    )
  }

  function normalize(input: {
    results: Array<CouncilSchema.Result>
    debates: Array<CouncilSchema.Debate>
    synth: CouncilSchema.Synthesis
  }) {
    return CouncilSchema.Synthesis.parse({
      ...input.synth,
      executive_summary:
        input.synth.executive_summary.trim() ||
        uniq(input.results.map((item) => item.executive_summary)).slice(0, 2).join("\n\n"),
      recommendation: input.synth.recommendation.trim() || input.synth.rationale[0] || "No recommendation captured.",
      decision_log:
        input.synth.decision_log.trim() ||
        [
          ...uniq(input.results.flatMap((item) => item.analysis ? [item.analysis] : [])),
          ...uniq(input.debates.map((item) => item.summary)),
        ]
          .join("\n\n")
          .slice(0, 4000),
      agreements: input.synth.agreements.length
        ? uniq(input.synth.agreements)
        : uniq([...recurring(input.results), ...input.debates.flatMap((item) => item.agreements)]),
      disagreements: input.synth.disagreements.length
        ? uniq(input.synth.disagreements)
        : uniq([
            ...input.debates.flatMap((item) => item.disagreements),
            ...input.debates.map((item) => item.topic),
          ]),
      tradeoffs: input.synth.tradeoffs.length
        ? uniq(input.synth.tradeoffs)
        : uniq(input.results.flatMap((item) => item.tradeoffs)),
      next_steps: input.synth.next_steps.length
        ? uniq(input.synth.next_steps)
        : uniq(input.results.flatMap((item) => item.recommendations)).slice(0, 5),
      open_questions: input.synth.open_questions.length
        ? uniq(input.synth.open_questions)
        : uniq(input.results.flatMap((item) => item.unknowns)),
    })
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

    const requestPath = `${dir}/request.json`
    const planPath = `${dir}/plan.json`
    const synthesisPath = `${dir}/synthesis.json`
    const reportPath = `${dir}/COUNCIL_REPORT.md`
    const reportHtmlPath = `${dir}/COUNCIL_REPORT.html`
    await CouncilArtifact.json(requestPath, input.input)

    const planMsg = await run({
      ctx: input.ctx,
      model: base.model,
      title: "Council planning",
      prompt: planPrompt(input.input),
      format: CouncilSchema.Plan,
    })
    const plan = parse(planMsg.message, CouncilSchema.Plan)
    await CouncilArtifact.json(planPath, plan)

    const tracker = {
      perspectives: plan.perspectives.map((item) => ({
        id: item.id,
        name: item.name,
        status: "pending" as "pending" | "running" | "completed" | "error",
        sessionID: "",
        preview: "",
      })),
      debates: [] as Array<{
        topic: string
        status: "pending" | "running" | "completed" | "error"
        preview: string
      }>,
    }
    const update = (stage: string) =>
      input.ctx.metadata({
        title: "Council analysis",
        metadata: {
          stage,
          dir,
          perspectives: tracker.perspectives,
          debates: tracker.debates,
        },
      })

    update("consulting")

    const results = await Promise.all(
      plan.perspectives.map(async (persona, index) => {
        const state = tracker.perspectives[index]
        const task = CouncilSchema.Task.parse({
          topic: plan.topic,
          summary: plan.summary,
          user_query: input.input.query,
          shared_context: [...input.input.context, ...plan.shared_context],
          persona,
          required_sections: [
            "executive_summary",
            "analysis",
            "findings",
            "recommendations",
            "tradeoffs",
            "unknowns",
            "confidence",
          ],
        })
        state.status = "running"
        update("consulting")
        try {
          const msg = await run({
            ctx: input.ctx,
            model: base.model,
            title: `Council: ${persona.name}`,
            prompt: taskPrompt(task),
            format: CouncilSchema.Result,
            onStart(sessionID) {
              state.sessionID = sessionID
              update("consulting")
            },
          })
          const result = parse(msg.message, CouncilSchema.Result)
          state.status = "completed"
          state.preview = (result.executive_summary || result.analysis || result.findings[0] || "").slice(0, 220)
          update("consulting")
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
            ...(result.analysis ? ["", result.analysis] : []),
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
            ...(result.confidence ? ["", `## Confidence`, result.confidence] : []),
            "",
          ].join("\n"),
        )
        return { task, result, json, md }
        } catch (error: any) {
          state.status = "error"
          state.preview = error?.message ?? String(error)
          update("consulting")
          throw error
        }
      }),
    )
    const perspectivePaths = results.map((item) => item.json)

    const debates = [] as Array<CouncilSchema.Debate & { json: string; md?: string }>
    const pairs = input.input.include_debate
      ? CouncilDebate.select({ plan, results: results.map((item) => item.result) })
      : []
    tracker.debates = pairs.map((item) => ({
      topic: item.topic,
      status: "pending",
      preview: "",
    }))
    if (pairs.length) {
      update("debating")
    }

    for (const [index, item] of pairs.entries()) {
      const state = tracker.debates[index]
      state.status = "running"
      update("debating")
      const tool = await DebateTool.init()
      const out = await tool.execute(
        {
          topic: item.topic,
          perspectives: item.participants,
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
        participants: out.metadata.participants ?? item.participants,
        rounds: out.metadata.roundsData ?? [],
        agreements: out.metadata.agreements ?? [],
        disagreements: out.metadata.disagreements ?? [],
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
      state.status = "completed"
      state.preview = debate.summary.slice(0, 220)
      update("debating")
    }
    const debatePaths = debates.map((item) => item.json)

    update("synthesizing")

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
    const synth = parse(synthMsg.message, CouncilSchema.Synthesis)
    const normalized = normalize({
      results: results.map((item) => item.result),
      debates,
      synth,
    })
    await CouncilArtifact.json(synthesisPath, normalized)

    const paths = CouncilSchema.Paths.parse({
      root: dir,
      request: requestPath,
      plan: planPath,
      perspectives: perspectivePaths,
      debates: debatePaths,
      synthesis: synthesisPath,
      report: reportPath,
      report_html: reportHtmlPath,
    })
    await CouncilArtifact.json(`${dir}/paths.json`, paths)

    const report = CouncilReport.render({
      query: input.input.query,
      plan,
      results,
      debates,
      synth: normalized,
    })
    await Bun.write(reportPath, report)
    await Bun.write(
      reportHtmlPath,
      RunHtml.council({
        dir,
        query: input.input.query,
        plan,
        results,
        debates,
        synth: normalized,
        report,
        reportPath,
        reportHtmlPath,
      }),
    )
    update("completed")

    return {
      dir,
      reportPath,
      reportHtmlPath,
      paths,
      plan,
      tracker,
      results,
      debates,
      synth: normalized,
    }
  }
}
