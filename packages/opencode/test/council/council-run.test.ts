import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import path from "path"
import z from "zod"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { CouncilRunTool } from "../../src/tool/council_run"
import { DebateTool } from "../../src/tool/debate"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { MessageV2 } from "../../src/session/message-v2"

afterEach(async () => {
  mock.restore()
  await resetDatabase()
})

function reply(input: {
  sessionID: string
  parentID: string
  text: string
  structured: unknown
}) {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      sessionID: input.sessionID,
      role: "assistant",
      time: { created: Date.now() },
      parentID: input.parentID,
      modelID: ModelID.make("gpt-4"),
      providerID: ProviderID.make("openai"),
      mode: "default",
      agent: "general",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      finish: "stop",
      structured: input.structured,
    },
    parts: [
      {
        id: PartID.ascending(),
        sessionID: input.sessionID,
        messageID: id,
        type: "text",
        text: input.text,
      },
    ],
  } as MessageV2.WithParts
}

async function setup(dir: string) {
  return await Instance.provide({
    directory: dir,
    fn: async () => {
      const session = await Session.create({ title: "Council test" })
      const user = await Session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: session.id,
        agent: "council",
        model: {
          providerID: ProviderID.make("openai"),
          modelID: ModelID.make("gpt-4"),
        },
        time: {
          created: Date.now(),
        },
      })
      const msg = await Session.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        sessionID: session.id,
        parentID: user.id,
        modelID: ModelID.make("gpt-4"),
        providerID: ProviderID.make("openai"),
        mode: "default",
        agent: "council",
        path: {
          cwd: dir,
          root: dir,
        },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        time: {
          created: Date.now(),
        },
        finish: "tool-calls",
      })

      return {
        sessionID: session.id,
        messageID: msg.id,
        callID: "test-call",
        agent: "council",
        abort: AbortSignal.any([]),
        messages: [],
        metadata: () => {},
        ask: async () => {},
      }
    },
  })
}

describe("council.council-run", () => {
  test("writes the full artifact tree without debate", async () => {
    await using tmp = await tmpdir()
    const ctx = await setup(tmp.path)
    const prompt = spyOn(SessionPrompt, "prompt")
    let i = 0
    prompt.mockImplementation(
      (async (input: Parameters<typeof SessionPrompt.prompt>[0]) => {
        i++
        if (i === 1) {
          return reply({
            sessionID: input.sessionID,
            parentID: ctx.messageID,
            text: "plan",
            structured: {
              topic: "Council v2",
              summary: "Move the workflow into code.",
              perspectives: [
                {
                  id: "arch",
                  name: "Architect",
                  description: "Focus on runtime shape.",
                  focus: ["contracts"],
                  questions: ["What should the runtime own?"],
                },
                {
                  id: "prag",
                  name: "Pragmatist",
                  description: "Focus on smallest safe slice.",
                  focus: ["scope"],
                  questions: ["What should ship first?"],
                },
              ],
              shared_context: ["general remains the only worker"],
              debate_topics: [],
              report_outline: ["summary", "recommendation"],
            },
          })
        }
        if (i === 2) {
          return reply({
            sessionID: input.sessionID,
            parentID: ctx.messageID,
            text: "architect",
          structured: {
            perspective: "Architect",
            executive_summary: "Code should own the flow.",
            findings: ["Council should generate artifacts in code."],
            recommendations: ["Move orchestration into council_run."],
            tradeoffs: ["More code to maintain."],
            unknowns: [],
            confidence: "high",
          },
        })
      }
        if (i === 3) {
          return reply({
            sessionID: input.sessionID,
            parentID: ctx.messageID,
            text: "pragmatist",
          structured: {
            perspective: "Pragmatist",
            executive_summary: "Ship the smallest useful slice.",
            findings: ["Council should generate artifacts in code."],
            recommendations: ["Start with planning, consult, and synthesis."],
            tradeoffs: ["The first slice will still be iterative."],
            unknowns: [],
            confidence: "medium",
          },
        })
      }
        return reply({
          sessionID: input.sessionID,
          parentID: ctx.messageID,
        text: "synthesis",
        structured: {
          recommendation: "Use council_run as the code-owned path.",
          rationale: ["It removes prompt/runtime drift."],
          agreements: [],
          disagreements: [],
          tradeoffs: [],
          next_steps: [],
          open_questions: [],
        },
      })
      }) as any,
    )

    const tool = await CouncilRunTool.init()
    const result = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        tool.execute(
          {
            query: "How should Council v2 work?",
            context: ["Keep general as the only worker"],
            include_debate: false,
          },
          ctx,
        ),
    })

    const root = path.join(tmp.path, ".opencode", "council", ctx.sessionID, ctx.messageID)
    expect(await Bun.file(path.join(root, "request.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(root, "plan.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(root, "paths.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(root, "synthesis.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(root, "COUNCIL_REPORT.md")).exists()).toBe(true)
    expect(await Bun.file(path.join(root, "perspectives", "arch.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(root, "perspectives", "prag.md")).exists()).toBe(true)
    expect(result.output).toContain("Council report:")
    expect(result.output).toContain("Use council_run as the code-owned path.")
    expect(result.metadata.planPath).toBe(path.join(root, "plan.json"))
    expect(result.metadata.synthesisPath).toBe(path.join(root, "synthesis.json"))
    expect(result.metadata.perspectivePaths).toEqual([
      path.join(root, "perspectives", "arch.json"),
      path.join(root, "perspectives", "prag.json"),
    ])
    const synth = (await Bun.file(path.join(root, "synthesis.json")).json()) as {
      agreements: string[]
      next_steps: string[]
      tradeoffs: string[]
    }
    expect(synth.agreements).toEqual(["Council should generate artifacts in code."])
    expect(synth.next_steps).toEqual([
      "Move orchestration into council_run.",
      "Start with planning, consult, and synthesis.",
    ])
    expect(synth.tradeoffs).toEqual(["More code to maintain.", "The first slice will still be iterative."])
  })

  test("persists structured debate artifacts when debate runs", async () => {
    await using tmp = await tmpdir()
    const ctx = await setup(tmp.path)
    const prompt = spyOn(SessionPrompt, "prompt")
    let i = 0
    prompt.mockImplementation(
      (async (input: Parameters<typeof SessionPrompt.prompt>[0]) => {
        i++
        if (i === 1) {
          return reply({
            sessionID: input.sessionID,
            parentID: ctx.messageID,
            text: "plan",
            structured: {
              topic: "API direction",
              summary: "Resolve whether Council should debate API tradeoffs.",
              perspectives: [
                {
                  id: "arch",
                  name: "Architect",
                  description: "Focus on contracts.",
                  focus: ["api"],
                  questions: ["How should artifacts look?"],
                },
                {
                  id: "prag",
                  name: "Pragmatist",
                  description: "Focus on delivery.",
                  focus: ["api"],
                  questions: ["What is enough for now?"],
                },
              ],
              shared_context: [],
              debate_topics: ["api"],
              report_outline: [],
            },
          })
        }
        if (i === 2 || i === 3) {
          return reply({
            sessionID: input.sessionID,
            parentID: ctx.messageID,
            text: "perspective",
            structured: {
            perspective: i === 2 ? "Architect" : "Pragmatist",
            executive_summary: "API shape matters.",
            findings: ["The api contract should be explicit."],
            recommendations: ["Refine the api before rollout."],
            tradeoffs: [],
            unknowns: [],
            confidence: "medium",
          },
        })
      }
        return reply({
          sessionID: input.sessionID,
          parentID: ctx.messageID,
          text: "synthesis",
          structured: {
            recommendation: "Keep debate available for material API conflicts.",
            rationale: ["The structured debate artifact now carries the key context."],
            agreements: ["Artifacts should be stored."],
            disagreements: ["How often debate should trigger."],
            tradeoffs: [],
            next_steps: [],
            open_questions: [],
          },
        })
      }) as any,
    )

    const debate = spyOn(DebateTool, "init").mockResolvedValue({
      description: "debate",
      parameters: z.object({}),
      execute: async () => {
        const root = path.join(tmp.path, "debate-source.md")
        await Bun.write(root, "# Debate")
        return {
          title: "debate",
          metadata: {
            topic: "api",
            perspectives: ["Architect", "Pragmatist"],
            rounds: 1,
            transcriptPath: root,
            participants: [
              { name: "Architect", position: "Favor stronger contracts." },
              { name: "Pragmatist", position: "Favor smaller steps." },
            ],
            agreements: ["Store artifacts in code."],
            disagreements: ["How much structure is enough."],
            roundsData: [
              {
                round: 1,
                responses: [{ perspective: "Architect", argument: "Make the contract explicit." }],
              },
            ],
          },
          output: "Structured debate summary",
        }
      },
    } as never)

    const tool = await CouncilRunTool.init()
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        tool.execute(
          {
            query: "Should Council debate API tradeoffs?",
            context: [],
            include_debate: true,
          },
          ctx,
        ),
    })

    const root = path.join(tmp.path, ".opencode", "council", ctx.sessionID, ctx.messageID)
    const file = path.join(root, "debates", "api.json")
    expect(await Bun.file(file).exists()).toBe(true)
    const json = (await Bun.file(file).json()) as {
      participants: Array<{ name: string }>
      rounds: Array<{ responses: Array<{ perspective: string }> }>
    }
    expect(json.participants.map((item) => item.name)).toEqual(["Architect", "Pragmatist"])
    expect(json.rounds[0].responses[0].perspective).toBe("Architect")
    expect(await Bun.file(path.join(root, "debates", "api.md")).exists()).toBe(true)
    expect(await Bun.file(path.join(root, "paths.json")).exists()).toBe(true)

    debate.mockRestore()
  })
})
