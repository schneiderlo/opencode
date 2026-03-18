import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { HeavyRunTool } from "../../src/tool/heavy_run"
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
      const calls: Array<{ title?: string; metadata?: any }> = []
      const session = await Session.create({ title: "Heavy test" })
      const user = await Session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: session.id,
        agent: "heavy",
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
        agent: "heavy",
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
        calls,
        ctx: {
          sessionID: session.id,
          messageID: msg.id,
          callID: "test-call",
          agent: "heavy",
          abort: AbortSignal.any([]),
          messages: [],
          metadata(input: { title?: string; metadata?: any }) {
            calls.push(input)
          },
          ask: async () => {},
        },
      }
    },
  })
}

describe("heavy.heavy-run", () => {
  test("writes the full artifact tree and exposes task progress", async () => {
    await using tmp = await tmpdir()
    const state = await setup(tmp.path)
    const prompt = spyOn(SessionPrompt, "prompt")
    let step = 0
    prompt.mockImplementation(
      (async (input: Parameters<typeof SessionPrompt.prompt>[0]) => {
        step++
        if (step === 1) {
          return reply({
            sessionID: input.sessionID,
            parentID: state.ctx.messageID,
            text: "plan",
            structured: {
              summary: "Break the work into search and reasoning tasks.",
              tasks: [
                {
                  id: "scan",
                  title: "Scan codebase",
                  agent: "explore",
                  goal: "Find the heavy mode implementation points.",
                  prompt: "Inspect the codebase for heavy mode files and summarize what they do.",
                  deliverable: "A file map and key findings.",
                },
                {
                  id: "design",
                  title: "Design runtime",
                  agent: "general",
                  goal: "Propose a more useful heavy runtime.",
                  prompt: "Design a code-owned heavy runtime with better progress and synthesis.",
                  deliverable: "A concrete runtime proposal.",
                },
              ],
              synthesis_focus: ["usefulness", "observability"],
            },
          })
        }
        if (step === 2) {
          return reply({
            sessionID: input.sessionID,
            parentID: state.ctx.messageID,
            text: "scan",
            structured: {
              task_id: "scan",
              title: "Scan codebase",
              summary: "The current heavy mode is prompt-led.",
              details: "It depends on map_reduce directly and exposes no structured task plan or synthesis artifact.",
              findings: ["Heavy has no code-owned runtime."],
              next_steps: ["Introduce heavy_run."],
            },
          })
        }
        if (step === 3) {
          return reply({
            sessionID: input.sessionID,
            parentID: state.ctx.messageID,
            text: "design",
            structured: {
              task_id: "design",
              title: "Design runtime",
              summary: "Heavy should use a dedicated runtime tool.",
              details: "A code-owned heavy path can preserve parallel execution while making the run legible and reproducible.",
              findings: ["Progress metadata should surface task status and previews."],
              next_steps: ["Persist a plan, task artifacts, and synthesis."],
            },
          })
        }
        return reply({
          sessionID: input.sessionID,
          parentID: state.ctx.messageID,
          text: "synthesis",
          structured: {
            summary: "",
            answer: "Use heavy_run as the default decomposition runtime for complex requests.",
            key_points: [],
            next_steps: [],
            open_questions: [],
          },
        })
      }) as any,
    )

    const tool = await HeavyRunTool.init()
    const result = await Instance.provide({
      directory: tmp.path,
      fn: () =>
        tool.execute(
          {
            query: "How should heavy mode work?",
            context: ["Prefer explicit progress"],
          },
          state.ctx,
        ),
    })

    const root = path.join(tmp.path, ".opencode", "heavy", state.ctx.sessionID, state.ctx.messageID)
    expect(await Bun.file(path.join(root, "request.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(root, "plan.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(root, "paths.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(root, "synthesis.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(root, "HEAVY_REPORT.md")).exists()).toBe(true)
    expect(await Bun.file(path.join(root, "tasks", "scan.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(root, "tasks", "design.md")).exists()).toBe(true)

    expect(result.output).toContain("Heavy report:")
    expect(result.output).toContain("Tasks:")
    expect(result.output).toContain("- Scan codebase (explore)")
    expect(result.output).toContain("Use heavy_run as the default decomposition runtime")
    expect(result.metadata.planPath).toBe(path.join(root, "plan.json"))
    expect(result.metadata.taskPaths).toEqual([
      path.join(root, "tasks", "scan.json"),
      path.join(root, "tasks", "design.json"),
    ])

    const synth = (await Bun.file(path.join(root, "synthesis.json")).json()) as {
      summary: string
      key_points: string[]
      next_steps: string[]
    }
    expect(synth.summary).toContain("The current heavy mode is prompt-led.")
    expect(synth.key_points).toEqual([
      "Heavy has no code-owned runtime.",
      "Progress metadata should surface task status and previews.",
    ])
    expect(synth.next_steps).toEqual(["Introduce heavy_run.", "Persist a plan, task artifacts, and synthesis."])

    const exec = state.calls.findLast((item) => item.metadata?.stage === "executing")
    expect(exec?.metadata?.tasks).toHaveLength(2)
    expect(exec?.metadata?.tasks[0].status).toBe("completed")
    expect(exec?.metadata?.tasks[0].sessionID).toMatch(/^ses_/)
    expect(exec?.metadata?.tasks[0].preview).toContain("The current heavy mode is prompt-led.")
  })
})
