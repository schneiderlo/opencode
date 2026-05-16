import { Agent } from "../agent/agent"
import { Config } from "../config/config"
import { CouncilArtifact } from "./artifact"
import { CouncilDebate } from "./debate"
import { CouncilReport } from "./report"
import { CouncilSchema } from "./schema"
import { RunHtml } from "../report/html"
import { DebateTool } from "../tool/debate"
import { MessageV2 } from "../session/message-v2"
import * as Session from "../session/session"
import { SessionPrompt } from "../session/prompt"
import { MessageID } from "../session/schema"
import * as Tool from "../tool/tool"
import { Cause, Effect, Exit } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { Permission } from "@/permission"
import { ModelID, ProviderID } from "../provider/schema"
import z from "zod"

const params = z.object({
  query: z.string(),
  context: z.array(z.string()).default([]),
  include_debate: z.boolean().default(true),
})

type Base = {
  modelID: ModelID
  providerID: ProviderID
}

type Tracker = {
  perspectives: Array<{
    id: string
    name: string
    status: "pending" | "running" | "completed" | "error"
    sessionID: string
    preview: string
  }>
  debates: Array<{
    topic: string
    status: "pending" | "running" | "completed" | "error"
    preview: string
  }>
}

export namespace CouncilService {
  export const Input = params
  export type Input = z.infer<typeof Input>

  const rules = [
    { permission: "todowrite", pattern: "*", action: "deny" },
    { permission: "todoread", pattern: "*", action: "deny" },
    { permission: "task", pattern: "*", action: "deny" },
    { permission: "map_reduce", pattern: "*", action: "deny" },
    { permission: "debate", pattern: "*", action: "deny" },
    { permission: "council_run", pattern: "*", action: "deny" },
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
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
    })
  }

  function run(input: {
    ctx: Tool.Context
    model: Base
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
      const agent = yield* agents.get("general")
      if (!agent) throw new Error("General agent not found")
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
          ...uniq(input.results.flatMap((item) => (item.analysis ? [item.analysis] : []))),
          ...uniq(input.debates.map((item) => item.summary)),
        ]
          .join("\n\n")
          .slice(0, 4000),
      agreements: input.synth.agreements.length
        ? uniq(input.synth.agreements)
        : uniq([...recurring(input.results), ...input.debates.flatMap((item) => item.agreements)]),
      disagreements: input.synth.disagreements.length
        ? uniq(input.synth.disagreements)
        : uniq([...input.debates.flatMap((item) => item.disagreements), ...input.debates.map((item) => item.topic)]),
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

  function update(input: { ctx: Tool.Context; stage: string; dir: string; tracker?: Tracker }) {
    return input.ctx.metadata({
      title: "Council analysis",
      metadata: {
        stage: input.stage,
        dir: input.dir,
        perspectives: input.tracker?.perspectives,
        debates: input.tracker?.debates,
      },
    })
  }

  export function execute(input: { input: Input; ctx: Tool.Context }) {
    return Effect.gen(function* () {
      yield* input.ctx.ask({
        permission: "council_run",
        patterns: [input.input.query.slice(0, 120)],
        always: ["*"],
        metadata: {
          query: input.input.query,
          includeDebate: input.input.include_debate,
        },
      })

      const base = yield* model(input.ctx)
      const dir = yield* CouncilArtifact.init({
        sessionID: input.ctx.sessionID,
        messageID: input.ctx.messageID,
      })

      yield* update({ ctx: input.ctx, stage: "planning", dir })

      const requestPath = `${dir}/request.json`
      const planPath = `${dir}/plan.json`
      const synthesisPath = `${dir}/synthesis.json`
      const reportPath = `${dir}/COUNCIL_REPORT.md`
      const reportHtmlPath = `${dir}/COUNCIL_REPORT.html`
      yield* CouncilArtifact.json(requestPath, input.input)

      const planMsg = yield* run({
        ctx: input.ctx,
        model: base,
        title: "Council planning",
        prompt: planPrompt(input.input),
        format: CouncilSchema.Plan,
      })
      const plan = parse(planMsg.message, CouncilSchema.Plan)
      yield* CouncilArtifact.json(planPath, plan)

      const tracker: Tracker = {
        perspectives: plan.perspectives.map((item) => ({
          id: item.id,
          name: item.name,
          status: "pending",
          sessionID: "",
          preview: "",
        })),
        debates: [],
      }

      yield* update({ ctx: input.ctx, stage: "consulting", dir, tracker })

      const results = yield* Effect.forEach(
        plan.perspectives,
        (persona, index) =>
          Effect.gen(function* () {
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
            yield* update({ ctx: input.ctx, stage: "consulting", dir, tracker })
            const msg = yield* run({
              ctx: input.ctx,
              model: base,
              title: `Council: ${persona.name}`,
              prompt: taskPrompt(task),
              format: CouncilSchema.Result,
              onStart(sessionID) {
                state.sessionID = sessionID
                return update({ ctx: input.ctx, stage: "consulting", dir, tracker })
              },
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.gen(function* () {
                  state.status = "error"
                  state.preview = text(cause)
                  yield* update({ ctx: input.ctx, stage: "consulting", dir, tracker })
                  return yield* Effect.failCause(cause)
                }),
              ),
            )
            const result = parse(msg.message, CouncilSchema.Result)
            state.status = "completed"
            state.preview = (result.executive_summary || result.analysis || result.findings[0] || "").slice(0, 220)
            yield* update({ ctx: input.ctx, stage: "consulting", dir, tracker })

            const id = CouncilArtifact.perspective(persona.id || persona.name)
            const json = `${dir}/perspectives/${id}.json`
            const md = `${dir}/perspectives/${id}.md`
            yield* CouncilArtifact.json(json, { task, result })
            yield* Effect.promise(() =>
              Bun.write(
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
                  (result.tradeoffs.length ? result.tradeoffs : ["None recorded"])
                    .map((item) => `- ${item}`)
                    .join("\n"),
                  "",
                  "## Unknowns",
                  (result.unknowns.length ? result.unknowns : ["None recorded"])
                    .map((item) => `- ${item}`)
                    .join("\n"),
                  ...(result.confidence ? ["", `## Confidence`, result.confidence] : []),
                  "",
                ].join("\n"),
              ),
            )
            return { task, result, json, md }
          }),
        { concurrency: "unbounded" },
      )
      const perspectivePaths = results.map((item) => item.json)

      const pairs = input.input.include_debate
        ? CouncilDebate.select({ plan, results: results.map((item) => item.result) })
        : []
      tracker.debates = pairs.map((item) => ({
        topic: item.topic,
        status: "pending",
        preview: "",
      }))
      if (pairs.length) yield* update({ ctx: input.ctx, stage: "debating", dir, tracker })

      const debateInfo = yield* DebateTool
      const debate = yield* Tool.init(debateInfo)
      const debates: Array<CouncilSchema.Debate & { json: string; md?: string }> = []
      for (const [index, item] of pairs.entries()) {
        const state = tracker.debates[index]
        state.status = "running"
        yield* update({ ctx: input.ctx, stage: "debating", dir, tracker })
        const out = yield* debate.execute(
          {
            topic: item.topic,
            perspectives: item.participants,
            rounds: 1,
          },
          {
            ...input.ctx,
            ask: () => Effect.void,
            metadata: () => Effect.void,
          },
        )
        const debateResult = CouncilSchema.Debate.parse({
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
        yield* CouncilArtifact.json(json, debateResult)
        if (out.metadata.transcriptPath) {
          const file = Bun.file(out.metadata.transcriptPath)
          if (yield* Effect.promise(() => file.exists())) yield* Effect.promise(() => file.text().then((body) => Bun.write(md, body)))
        }
        const exists = yield* Effect.promise(() => Bun.file(md).exists())
        debates.push({ ...debateResult, json, md: exists ? md : undefined })
        state.status = "completed"
        state.preview = debateResult.summary.slice(0, 220)
        yield* update({ ctx: input.ctx, stage: "debating", dir, tracker })
      }
      const debatePaths = debates.map((item) => item.json)

      yield* update({ ctx: input.ctx, stage: "synthesizing", dir, tracker })

      const synthMsg = yield* run({
        ctx: input.ctx,
        model: base,
        title: "Council synthesis",
        prompt: synthPrompt({
          query: input.input.query,
          plan,
          results: results.map((item) => item.result),
          debates,
        }),
        format: CouncilSchema.Synthesis,
      })
      const normalized = normalize({
        results: results.map((item) => item.result),
        debates,
        synth: parse(synthMsg.message, CouncilSchema.Synthesis),
      })
      yield* CouncilArtifact.json(synthesisPath, normalized)

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
      yield* CouncilArtifact.json(`${dir}/paths.json`, paths)

      const report = CouncilReport.render({
        query: input.input.query,
        plan,
        results,
        debates,
        synth: normalized,
      })
      yield* Effect.promise(() => Bun.write(reportPath, report))
      yield* Effect.promise(() =>
        Bun.write(
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
        ),
      )
      yield* update({ ctx: input.ctx, stage: "completed", dir, tracker })

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
    })
  }
}
