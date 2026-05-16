import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Session } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import * as SessionPrompt from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MapReduceTool } from "../../src/tool/map_reduce"
import { Truncate } from "@/tool/truncate"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const layer = Layer.mergeAll(
  Agent.defaultLayer,
  Config.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Session.defaultLayer,
  Truncate.defaultLayer,
  RuntimeFlags.defaultLayer,
)

const it = testEffect(layer)

const seed = Effect.fn("MapReduceToolTest.seed")(function* () {
  const session = yield* Session.Service
  const chat = yield* session.create({ title: "Map reduce test" })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function reply(input: SessionPrompt.PromptInput, text: string): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

function prompt(seen: SessionPrompt.PromptInput[]): SessionPrompt.Interface {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        seen.push(input)
        return reply(input, "done")
      }),
    loop: (input) => Effect.succeed(reply({ sessionID: input.sessionID, parts: [] }, "done")),
    shell: (input) =>
      Effect.succeed(reply({ sessionID: input.sessionID, messageID: input.messageID, parts: [] }, "done")),
    command: (input) =>
      Effect.succeed(reply({ sessionID: input.sessionID, messageID: input.messageID, parts: [] }, "done")),
  }
}

describe("tool.map_reduce", () => {
  it.instance(
    "shapes child permissions and disabled tools consistently",
    () => {
      const seen: SessionPrompt.PromptInput[] = []
      return Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* MapReduceTool
        const def = yield* tool.init()
        const meta: Array<{ title?: string; metadata?: unknown }> = []

        const result = yield* def.execute(
          {
            tasks: [
              {
                description: "inspect bug",
                prompt: "look into the cache key path",
                subagent_type: "reviewer",
              },
            ],
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata: (input) =>
              Effect.sync(() => {
                meta.push(input)
              }),
            ask: () => Effect.void,
          },
        )

        const kids = yield* sessions.children(chat.id)
        expect(kids).toHaveLength(1)
        expect(kids[0]?.permission).toEqual([
          {
            permission: "todowrite",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "todoread",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "map_reduce",
            pattern: "*",
            action: "allow",
          },
          {
            permission: "task",
            pattern: "*",
            action: "allow",
          },
          {
            permission: "bash",
            pattern: "*",
            action: "allow",
          },
          {
            permission: "read",
            pattern: "*",
            action: "allow",
          },
        ])
        expect(seen[0]?.tools).toEqual({
          todowrite: false,
          todoread: false,
          map_reduce: true,
          bash: false,
          read: false,
        })
        expect(result.metadata.tasks?.[0]?.status).toBe("completed")
        expect(result.output).toContain("done")
        expect(meta.length).toBeGreaterThan(0)
      }).pipe(Effect.provideService(SessionPrompt.Service, SessionPrompt.Service.of(prompt(seen))))
    },
    {
      config: {
        agent: {
          reviewer: {
            mode: "subagent",
            permission: {
              task: "allow",
            },
          },
        },
        experimental: {
          primary_tools: ["bash", "read"],
        },
      },
    },
  )
})
