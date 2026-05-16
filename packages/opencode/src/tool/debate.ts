import * as Tool from "./tool"
import DESCRIPTION from "./debate.txt"
import z from "zod"
import * as Session from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { Config } from "../config/config"
import path from "path"
import { mkdir } from "fs/promises"
import { MessageID } from "../session/schema"
import { ModelID, ProviderID } from "../provider/schema"
import { Cause, Effect, Exit } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { InstanceState } from "@/effect/instance-state"

const DebateArtifact = z.object({
  topic: z.string(),
  summary: z.string(),
  participants: z.array(
    z.object({
      name: z.string(),
      position: z.string(),
    }),
  ),
  rounds: z.array(
    z.object({
      round: z.number().int().positive(),
      responses: z.array(
        z.object({
          perspective: z.string(),
          argument: z.string(),
        }),
      ),
    }),
  ),
  agreements: z.array(z.string()).default([]),
  disagreements: z.array(z.string()).default([]),
  transcript_path: z.string().optional(),
})

const parameters = z.object({
  topic: z.string().describe("The specific point of contention being debated"),
  perspectives: z
    .array(
      z.object({
        name: z.string().describe("The perspective name (e.g., 'Security Expert', 'Pragmatist')"),
        position: z.string().describe("Their initial position/argument on the topic"),
      }),
    )
    .min(2, "At least 2 perspectives required for debate")
    .max(3, "Maximum 3 perspectives to keep debate focused")
    .describe("The perspectives participating in the debate"),
  rounds: z.number().int().min(1).max(3).default(1).describe("Number of debate rounds (1-2 recommended)"),
})

type Input = z.infer<typeof parameters>
type Round = { round: number; responses: Array<{ perspective: string; argument: string }> }
type Metadata = Record<string, unknown> & {
  topic?: string
  perspectives?: string[]
  rounds?: number
  transcriptPath?: string
  jsonPath?: string
  participants?: Array<{ name: string; position: string }>
  agreements?: string[]
  disagreements?: string[]
  roundsData?: Round[]
}

function text(error: unknown) {
  if (Cause.isCause(error)) return Cause.pretty(error)
  if (error instanceof Error) return error.message
  return String(error)
}

function select(
  pool: Array<{ modelID: string; providerID: string }> | undefined,
  base: { modelID: ModelID; providerID: ProviderID },
) {
  if (!pool?.length) return base
  const item = pool[Math.floor(Math.random() * pool.length)]
  return {
    modelID: ModelID.make(item.modelID),
    providerID: ProviderID.make(item.providerID),
  }
}

export const DebateTool = Tool.define<typeof parameters, Metadata, never>(
  "debate",
  Effect.succeed({
    description: DESCRIPTION,
    parameters,
    execute: (params: Input, ctx: Tool.Context<Metadata>) =>
      Effect.gen(function* () {
        const cfg = yield* Config.Service.use((svc) => svc.get())
        const sessions = yield* Session.Service
        const agents = yield* Agent.Service
        const prompt = yield* SessionPrompt.Service
        const bridge = yield* EffectBridge.make()
        const inst = yield* InstanceState.context
        const rounds = params.rounds ?? 1
        const caller = yield* agents.get(ctx.agent)
        const pool = caller.modelPool

        const tracker = {
          topic: params.topic,
          rounds: [] as Round[],
          status: "pending" as "pending" | "running" | "completed" | "error",
        }

        const update = () =>
          ctx.metadata({
            title: `Debate: ${params.topic.slice(0, 50)}...`,
            metadata: {
              topic: params.topic,
              perspectives: params.perspectives.map((item) => item.name),
              roundsCompleted: tracker.rounds.length,
              totalRounds: rounds,
              status: tracker.status,
            },
          })

        yield* update()
        tracker.status = "running"
        yield* update()

        yield* ctx
          .ask({
            permission: "debate",
            patterns: params.perspectives.map((item) => item.name),
            always: ["*"],
            metadata: {
              description: `Debate between ${params.perspectives.map((item) => item.name).join(", ")} for ${rounds} round(s)`,
              topic: params.topic,
              rounds,
            },
          })
          .pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                tracker.status = "error"
                yield* update()
                return yield* Effect.fail(error)
              }),
            ),
          )

        const agent = yield* agents.get("general")
        if (!agent) throw new Error("General agent not found for debate")

        const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
        if (msg.info.role !== "assistant") throw new Error("Not an assistant message")
        const base = agent.model ?? {
          modelID: msg.info.modelID,
          providerID: msg.info.providerID,
        }

        const history: Array<{ perspective: string; argument: string }> = params.perspectives.map((item) => ({
          perspective: item.name,
          argument: item.position,
        }))

        for (let i = 1; i <= rounds; i++) {
          const responses: Array<{ perspective: string; argument: string }> = []

          for (const perspective of params.perspectives) {
            const others = history.filter((item) => item.perspective !== perspective.name)
            const othersText = others.map((item) => `**${item.perspective}**: ${item.argument}`).join("\n\n")
            const body = debatePrompt({
              topic: params.topic,
              name: perspective.name,
              position: perspective.position,
              others: othersText,
              round: i,
              rounds,
            })

            const next = yield* sessions.create({
              parentID: ctx.sessionID,
              title: `Debate: ${perspective.name} (Round ${i})`,
              permission: [
                { permission: "todowrite", pattern: "*", action: "deny" },
                { permission: "todoread", pattern: "*", action: "deny" },
                { permission: "task", pattern: "*", action: "deny" },
                { permission: "map_reduce", pattern: "*", action: "deny" },
                { permission: "debate", pattern: "*", action: "deny" },
                ...(cfg.experimental?.primary_tools?.map((name) => ({
                  pattern: "*",
                  action: "deny" as const,
                  permission: name,
                })) ?? []),
              ],
            })

            const cancel = prompt.cancel(next.id)
            function abort() {
              bridge.fork(cancel)
            }

            const result = yield* Effect.acquireUseRelease(
              Effect.sync(() => {
                ctx.abort.addEventListener("abort", abort)
              }),
              () =>
                Effect.gen(function* () {
                  const parts = yield* prompt.resolvePromptParts(
                    "You are participating in a structured debate. Provide your response directly without using any tools.\n\n" +
                      body,
                  )
                  return yield* prompt.prompt({
                    messageID: MessageID.ascending(),
                    sessionID: next.id,
                    model: select(pool, base),
                    agent: agent.name,
                    tools: { "*": false },
                    parts,
                  })
                }),
              (_, exit) =>
                Effect.gen(function* () {
                  if (Exit.hasInterrupts(exit)) yield* cancel
                }).pipe(
                  Effect.ensuring(
                    Effect.sync(() => {
                      ctx.abort.removeEventListener("abort", abort)
                    }),
                  ),
                ),
            )

            const content = result.parts.findLast((part) => part.type === "text")?.text ?? ""
            responses.push({ perspective: perspective.name, argument: content })
            history.push({ perspective: perspective.name, argument: content })
          }

          tracker.rounds.push({ round: i, responses })
          yield* update()
        }

        const dir = path.join(inst.directory, ".opencode", "council", ctx.sessionID)
        yield* Effect.promise(() => mkdir(dir, { recursive: true }))
        const file = path.join(dir, `debate_${Date.now()}.md`)
        const transcript = formatDebateTranscript(params.topic, params.perspectives, tracker.rounds)
        yield* Effect.promise(() => Bun.write(file, transcript))

        tracker.status = "completed"
        yield* update()

        const synthesis = generateDebateSynthesis(params.topic, params.perspectives, tracker.rounds)
        const artifact = DebateArtifact.parse({
          topic: params.topic,
          summary: synthesis,
          participants: params.perspectives,
          rounds: tracker.rounds,
          agreements: [],
          disagreements: params.perspectives.map((item) => item.name),
          transcript_path: file,
        })
        const json = path.join(dir, `debate_${Date.now()}.json`)
        yield* Effect.promise(() => Bun.write(json, JSON.stringify(artifact, null, 2) + "\n"))

        return {
          title: `Debate completed: ${rounds} round(s)`,
          metadata: {
            topic: params.topic,
            perspectives: params.perspectives.map((item) => item.name),
            rounds: tracker.rounds.length,
            transcriptPath: file,
            jsonPath: json,
            participants: artifact.participants,
            agreements: artifact.agreements,
            disagreements: artifact.disagreements,
            roundsData: artifact.rounds,
          },
          output: synthesis,
        }
      }).pipe(
        Effect.catchCause((cause) => Effect.fail(new Error(text(cause)))),
        Effect.orDie,
      ) as unknown as Effect.Effect<Tool.ExecuteResult<Metadata>>,
  }),
)

function debatePrompt(input: {
  topic: string
  name: string
  position: string
  others: string
  round: number
  rounds: number
}) {
  return `You are continuing a structured debate from the perspective of a ${input.name}.

## Topic Being Debated
${input.topic}

## Your Previous Position
${input.position}

## Other Perspectives Have Argued
${input.others}

## Your Task (Round ${input.round} of ${input.rounds})

Provide a DETAILED and SUBSTANTIVE response to the other perspectives' arguments. Your response should be comprehensive - aim for 400-800 words.

Structure your response as follows:

### Points of Agreement
Acknowledge valid points raised by other perspectives. Be specific about what you agree with and why.

### Counter-Arguments
For arguments you disagree with:
- State the specific claim you're addressing
- Explain why you disagree with clear reasoning
- Provide evidence, examples, or logical arguments to support your position
- Consider potential rebuttals to your counter-arguments

### Refined Position
Based on this round of discussion:
- Has your position evolved? If so, how and why?
- What aspects of your original position do you hold more strongly now?
- Are there any new considerations that have emerged?

### Key Takeaways
What are the 2-3 most important points you want the other perspectives and the final synthesizer to understand from your position?

Be thorough and substantive. This debate is meant to surface the best arguments and reach a well-reasoned conclusion.`
}

function formatDebateTranscript(
  topic: string,
  perspectives: Array<{ name: string; position: string }>,
  rounds: Round[],
): string {
  const head = [`# Debate Transcript`, "", `## Topic`, topic, "", `## Initial Positions`, ""]
  const initial = perspectives.flatMap((item) => [`### ${item.name}`, item.position, ""])
  const body = rounds.flatMap((round) => [
    "---",
    "",
    `## Round ${round.round}`,
    "",
    ...round.responses.flatMap((item) => [`### ${item.perspective}`, item.argument, ""]),
  ])
  return [...head, ...initial, ...body].join("\n")
}

function generateDebateSynthesis(
  topic: string,
  perspectives: Array<{ name: string; position: string }>,
  rounds: Round[],
): string {
  return [
    `## Debate Summary: ${topic}`,
    "",
    "### Initial Positions",
    "",
    ...perspectives.flatMap((item) => [`#### ${item.name}`, item.position, ""]),
    "---",
    "",
    "### Debate Rounds",
    "",
    ...rounds.flatMap((round) => [
      `#### Round ${round.round}`,
      "",
      ...round.responses.flatMap((item) => [`##### ${item.perspective}`, item.argument, ""]),
      "---",
      "",
    ]),
    "### Synthesis Notes",
    "",
    `This debate involved ${perspectives.length} perspectives over ${rounds.length} round(s).`,
    "",
    "**When synthesizing, consider:**",
    "- Which arguments were strongest and why?",
    "- Where did perspectives converge during the debate?",
    "- What are the remaining points of genuine disagreement?",
    "- What underlying assumptions or values drive the different positions?",
    "- What would be the most balanced recommendation given all viewpoints?",
  ].join("\n")
}
