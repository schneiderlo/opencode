import { expect, test, mock } from "bun:test"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { MessageV2 } from "../../src/session/message-v2"
import type { PlannerOutput } from "../../src/session/heavy"

// Mock the 'ai' package
mock.module("ai", () => {
  return {
    generateObject: async (_args: any) => {
      const plan: PlannerOutput = {
        original_query: "Test query",
        sub_tasks: [
          { id: 1, question: "Task 1 question", deliverable: "Report 1" },
          { id: 2, question: "Task 2 question", deliverable: "Report 2" },
          { id: 3, question: "Task 3 question", deliverable: "Report 3" },
        ],
      }
      return {
        object: plan,
        usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 0, cachedInputTokens: 0 },
      }
    },
    generateText: async (_args: any) => {
      return { text: "{}" }
    },
    streamText: (args: any) => {
      const res = args.messages.at(-1).content[0]
      async function* gen() {
        yield { type: "text-start" }
        yield { type: "text-delta", text: (res as any).value }
        yield { type: "text-end" }
        yield { type: "finish", usage: { inputTokens: 5, outputTokens: 10, reasoningTokens: 0, cachedInputTokens: 0 } }
      }
      return { fullStream: gen() }
    },
  }
})

test("heavy mode integration test", async () => {
  const session = await Session.create()
  const chatPromise = Session.chat({
    sessionID: session.id,
    providerID: "anthropic",
    modelID: "claude-3-opus-20240229",
    mode: "heavy",
    parts: [{ type: "text", text: "Test heavy mode" }],
  })

  // Wait for the plan to be generated and ready for approval
  await new Promise((resolve) => setTimeout(resolve, 100))

  // Approve the plan
  Session.respondPlan({ sessionID: session.id, approved: true })

  const result = await chatPromise
  expect(result.info.role).toBe("assistant")

  const costPart = result.parts.find((p) => p.type === "heavy_cost") as MessageV2.HeavyCostPart | undefined
  expect(costPart).toBeDefined()
  expect(costPart?.total.cost).toBeGreaterThan(0)
  expect(costPart?.total.tokens.input).toBe(15)
  expect(costPart?.total.tokens.output).toBe(30)
})
