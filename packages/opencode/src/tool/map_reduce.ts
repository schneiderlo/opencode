import * as Tool from "./tool"
import DESCRIPTION from "./map_reduce.txt"
import z from "zod"
import * as Session from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { Config } from "../config/config"
import { Permission } from "@/permission"
import { MessageID, type SessionID } from "../session/schema"
import { Cause, Effect, Exit } from "effect"
import { EffectBridge } from "@/effect/bridge"

const parameters = z.object({
  tasks: z
    .array(
      z.object({
        description: z.string().describe("A short (3-5 words) description of the task"),
        prompt: z.string().describe("The task for the agent to perform"),
        subagent_type: z.string().describe("The type of specialized agent to use for this task"),
      }),
    )
    .min(1, "Provide at least one task")
    .describe("List of tasks to execute in parallel"),
})

type Input = z.infer<typeof parameters>
type Status = "pending" | "running" | "completed" | "error"
type Metadata = {
  tasks?: Array<{
    id: string
    description: string
    subagent: string
    sessionId: string
    status: Status
    error?: string
  }>
}

function message(error: unknown) {
  if (Cause.isCause(error)) return Cause.pretty(error)
  if (error instanceof Error) return error.message
  return String(error)
}

function depth(sessions: Session.Interface, id: SessionID, count = 0): Effect.Effect<number> {
  return sessions.get(id).pipe(
    Effect.flatMap((session) => {
      if (!session.parentID) return Effect.succeed(count)
      if (count > 10) return Effect.succeed(count)
      return depth(sessions, session.parentID, count + 1)
    }),
    Effect.catch(() => Effect.succeed(count)),
  )
}

export const MapReduceTool = Tool.define<typeof parameters, Metadata, never>(
  "map_reduce",
  Effect.succeed({
    description: DESCRIPTION,
    parameters,
    execute: (params: Input, ctx: Tool.Context<Metadata>) =>
      Effect.gen(function* () {
        const config = yield* Config.Service
        const sessions = yield* Session.Service
        const agents = yield* Agent.Service
        const prompt = yield* SessionPrompt.Service
        const bridge = yield* EffectBridge.make()
        const cfg = yield* config.get()

        const tracker = params.tasks.map((task, index) => ({
          id: Identifier.ascending("tool"),
          description: task.description,
          subagent: task.subagent_type,
          status: "pending" as Status,
          sessionId: "",
          error: undefined as string | undefined,
          output: undefined as string | undefined,
          index,
        }))

        const update = () =>
          ctx.metadata({
            title: `Map-Reduce: ${params.tasks.length} tasks`,
            metadata: {
              tasks: tracker.map((item) => ({
                id: item.id,
                description: item.description,
                subagent: item.subagent,
                sessionId: item.sessionId,
                status: item.status,
                error: item.error,
              })),
            },
          })

        yield* update()

        const count = yield* depth(sessions, ctx.sessionID)
        const recur = count < 3

        if (!ctx.extra?.bypassAgentCheck) {
          yield* ctx
            .ask({
              permission: "task",
              patterns: params.tasks.map((task) => task.subagent_type),
              always: ["*"],
              metadata: {
                description: `Execute ${params.tasks.length} tasks in parallel`,
                count: params.tasks.length,
              },
            })
            .pipe(
              Effect.catch((error) =>
                Effect.gen(function* () {
                  const text = message(error)
                  for (const item of tracker) {
                    item.status = "error"
                    item.error = text
                  }
                  yield* update()
                  return yield* Effect.fail(error)
                }),
              ),
            )
        }

        const results = yield* Effect.forEach(
          params.tasks,
          (task, index) =>
            Effect.gen(function* () {
              const item = tracker[index]
              const agent = yield* agents.get(task.subagent_type)
              if (!agent) throw new Error(`Unknown agent type: ${task.subagent_type}`)

              const has = agent.permission.some((rule) => rule.permission === "task")
              const next = yield* sessions.create({
                parentID: ctx.sessionID,
                title: `${task.description} (@${agent.name} subagent)`,
                permission: [
                  { permission: "todowrite", pattern: "*", action: "deny" },
                  { permission: "todoread", pattern: "*", action: "deny" },
                  ...(recur
                    ? [
                        { permission: "map_reduce" as const, pattern: "*", action: "allow" as const },
                        { permission: "task" as const, pattern: "*", action: "allow" as const },
                      ]
                    : !has
                      ? [{ permission: "task" as const, pattern: "*", action: "deny" as const }]
                      : []),
                  ...(cfg.experimental?.primary_tools?.map((name) => ({
                    pattern: "*",
                    action: "allow" as const,
                    permission: name,
                  })) ?? []),
                ] satisfies Permission.Ruleset,
              })

              item.sessionId = next.id
              item.status = "running"
              yield* update()

              const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
              if (msg.info.role !== "assistant") throw new Error("Not an assistant message")
              const model = agent.model ?? {
                modelID: msg.info.modelID,
                providerID: msg.info.providerID,
              }

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
                    const parts = yield* prompt.resolvePromptParts(task.prompt)
                    return yield* prompt.prompt({
                      messageID: MessageID.ascending(),
                      sessionID: next.id,
                      model,
                      agent: agent.name,
                      tools: {
                        todowrite: false,
                        todoread: false,
                        map_reduce: recur,
                        ...(has ? {} : { task: false }),
                        ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((tool) => [tool, false])),
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
                        ctx.abort.removeEventListener("abort", abort)
                      }),
                    ),
                  ),
              )

              const text = result.parts.findLast((part) => part.type === "text")?.text ?? ""
              item.output = text
              item.status = "completed"
              yield* update()
              return text
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.gen(function* () {
                  const item = tracker[index]
                  const text = message(cause)
                  item.status = "error"
                  item.error = text
                  yield* update()
                  return `Task failed: ${text}`
                }),
              ),
            ),
          { concurrency: "unbounded" },
        )

        return {
          title: `Completed ${params.tasks.length} tasks`,
          metadata: {
            tasks: tracker.map((item) => ({
              id: item.id,
              description: item.description,
              subagent: item.subagent,
              sessionId: item.sessionId,
              status: item.status,
              error: item.error,
            })),
          },
          output: results
            .map((result, index) => `## Task ${index + 1}: ${params.tasks[index].description}\n\n${result}`)
            .join("\n\n---\n\n"),
        }
      }).pipe(Effect.orDie) as unknown as Effect.Effect<Tool.ExecuteResult<Metadata>>,
  }),
)
