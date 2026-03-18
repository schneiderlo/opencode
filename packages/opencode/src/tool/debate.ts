import { Tool } from "./tool"
import DESCRIPTION from "./debate.txt"
import z from "zod"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"
import { Instance } from "../project/instance"
import path from "path"
import { mkdir } from "fs/promises"
import { MessageID } from "../session/schema"
import { ModelID, ProviderID } from "../provider/schema"

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

export const DebateTool = Tool.define("debate", async (initCtx) => {
  // Get the model pool from the calling agent (set during init)
  const modelPool = initCtx?.agent?.modelPool

  return {
    description: DESCRIPTION,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()
      const rounds = params.rounds ?? 1

      // Helper to select a model from the pool (random) or fall back to default
      const selectModel = (defaultModel: { modelID: ModelID; providerID: ProviderID }) => {
        if (modelPool && modelPool.length > 0) {
          const idx = Math.floor(Math.random() * modelPool.length)
          return {
            modelID: ModelID.make(modelPool[idx].modelID),
            providerID: ProviderID.make(modelPool[idx].providerID),
          }
        }
        return defaultModel
      }

      // Track debate state
      const tracker = {
        topic: params.topic,
        rounds: [] as Array<{
          round: number
          responses: Array<{ perspective: string; argument: string }>
        }>,
        status: "pending" as "pending" | "running" | "completed" | "error",
      }

      const updateMetadata = () => {
        ctx.metadata({
          title: `Debate: ${params.topic.slice(0, 50)}...`,
          metadata: {
            topic: params.topic,
            perspectives: params.perspectives.map((p) => p.name),
            roundsCompleted: tracker.rounds.length,
            totalRounds: rounds,
            status: tracker.status,
          },
        })
      }

      updateMetadata()
      tracker.status = "running"
      updateMetadata()

      // Ask permission
      try {
        await ctx.ask({
          permission: "debate",
          patterns: params.perspectives.map((p) => p.name),
          always: ["*"],
          metadata: {
            description: `Debate between ${params.perspectives.map((p) => p.name).join(", ")} for ${rounds} round(s)`,
            topic: params.topic,
            rounds,
          },
        })
      } catch (err: any) {
        tracker.status = "error"
        updateMetadata()
        throw err
      }

      const agent = await Agent.get("general")
      if (!agent) throw new Error("General agent not found for debate")

      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const defaultModel = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      // Build conversation history for each round
      const history: Array<{ perspective: string; argument: string }> = params.perspectives.map((p) => ({
        perspective: p.name,
        argument: p.position,
      }))

      // Execute debate rounds
      for (let round = 1; round <= rounds; round++) {
        const roundResponses: Array<{ perspective: string; argument: string }> = []

        // Each perspective responds to the others
        for (const perspective of params.perspectives) {
          const others = history.filter((h) => h.perspective !== perspective.name)
          const othersText = others.map((o) => `**${o.perspective}**: ${o.argument}`).join("\n\n")

          const prompt = `You are continuing a structured debate from the perspective of a ${perspective.name}.

## Topic Being Debated
${params.topic}

## Your Previous Position
${perspective.position}

## Other Perspectives Have Argued
${othersText}

## Your Task (Round ${round} of ${rounds})

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
What are the 2-3 most important points you want the other perspectives (and the final synthesizer) to understand from your position?

Be thorough and substantive. This debate is meant to surface the best arguments and reach a well-reasoned conclusion.`

          const session = await Session.create({
            parentID: ctx.sessionID,
            title: `Debate: ${perspective.name} (Round ${round})`,
            permission: [
              { permission: "todowrite", pattern: "*", action: "deny" },
              { permission: "todoread", pattern: "*", action: "deny" },
              { permission: "task", pattern: "*", action: "deny" },
              { permission: "map_reduce", pattern: "*", action: "deny" },
              { permission: "debate", pattern: "*", action: "deny" },
            ],
          })

          const messageID = MessageID.ascending()

          function cancel() {
            SessionPrompt.cancel(session.id)
          }
          ctx.abort.addEventListener("abort", cancel)
          using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))

          const systemNote =
            "You are participating in a structured debate. Provide your response directly without using any tools.\n\n"
          const promptParts = await SessionPrompt.resolvePromptParts(systemNote + prompt)

          const result = await SessionPrompt.prompt({
            messageID,
            sessionID: session.id,
            model: selectModel(defaultModel),
            agent: agent.name,
            tools: {
              "*": false, // Disable all tools for debate responses
            },
            parts: promptParts,
          })

          const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
          roundResponses.push({ perspective: perspective.name, argument: text })
          history.push({ perspective: perspective.name, argument: text })
        }

        tracker.rounds.push({ round, responses: roundResponses })
        updateMetadata()
      }

      // Save debate transcript
      const outputDir = path.join(Instance.directory, ".opencode", "council", ctx.sessionID)
      await mkdir(outputDir, { recursive: true })
      const filename = `debate_${Date.now()}.md`
      const filepath = path.join(outputDir, filename)

      const transcript = formatDebateTranscript(params.topic, params.perspectives, tracker.rounds)
      await Bun.write(filepath, transcript)

      tracker.status = "completed"
      updateMetadata()

      // Generate synthesis
      const synthesis = generateDebateSynthesis(params.topic, params.perspectives, tracker.rounds)
      const artifact = DebateArtifact.parse({
        topic: params.topic,
        summary: synthesis,
        participants: params.perspectives,
        rounds: tracker.rounds,
        agreements: [],
        disagreements: params.perspectives.map((item) => item.name),
        transcript_path: filepath,
      })
      const jsonPath = path.join(outputDir, `debate_${Date.now()}.json`)
      await Bun.write(jsonPath, JSON.stringify(artifact, null, 2) + "\n")

      return {
        title: `Debate completed: ${rounds} round(s)`,
        metadata: {
          topic: params.topic,
          perspectives: params.perspectives.map((p) => p.name),
          rounds: tracker.rounds.length,
          transcriptPath: filepath,
          jsonPath,
          participants: artifact.participants,
          agreements: artifact.agreements,
          disagreements: artifact.disagreements,
          roundsData: artifact.rounds,
        },
        output: synthesis,
      }
    },
  }
})

function formatDebateTranscript(
  topic: string,
  perspectives: Array<{ name: string; position: string }>,
  rounds: Array<{ round: number; responses: Array<{ perspective: string; argument: string }> }>,
): string {
  let md = `# Debate Transcript\n\n`
  md += `## Topic\n${topic}\n\n`
  md += `## Initial Positions\n\n`

  for (const p of perspectives) {
    md += `### ${p.name}\n${p.position}\n\n`
  }

  for (const round of rounds) {
    md += `---\n\n## Round ${round.round}\n\n`
    for (const response of round.responses) {
      md += `### ${response.perspective}\n${response.argument}\n\n`
    }
  }

  return md
}

function generateDebateSynthesis(
  topic: string,
  perspectives: Array<{ name: string; position: string }>,
  rounds: Array<{ round: number; responses: Array<{ perspective: string; argument: string }> }>,
): string {
  let output = `## Debate Summary: ${topic}\n\n`

  output += `### Initial Positions\n\n`
  for (const p of perspectives) {
    output += `#### ${p.name}\n${p.position}\n\n`
  }

  output += `---\n\n### Debate Rounds\n\n`
  for (const round of rounds) {
    output += `#### Round ${round.round}\n\n`
    for (const response of round.responses) {
      output += `##### ${response.perspective}\n${response.argument}\n\n`
    }
    output += `---\n\n`
  }

  output += `### Synthesis Notes\n\n`
  output += `This debate involved ${perspectives.length} perspectives over ${rounds.length} round(s).\n\n`
  output += `**When synthesizing, consider:**\n`
  output += `- Which arguments were strongest and why?\n`
  output += `- Where did perspectives converge during the debate?\n`
  output += `- What are the remaining points of genuine disagreement?\n`
  output += `- What underlying assumptions or values drive the different positions?\n`
  output += `- What would be the most balanced recommendation given all viewpoints?\n`

  return output
}
