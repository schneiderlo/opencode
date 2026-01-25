import { Tool } from "./tool"
import DESCRIPTION from "./map_reduce.txt"
import z from "zod"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { PermissionNext } from "@/permission/next"

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

export const MapReduceTool = Tool.define("map_reduce", async (ctx) => {
  return {
    description: DESCRIPTION,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()

      // Prepare metadata tracker
      const tracker = params.tasks.map((task, index) => ({
        id: Identifier.ascending("tool"),
        description: task.description,
        subagent: task.subagent_type,
        status: "pending" as "pending" | "running" | "completed" | "error",
        sessionId: "",
        error: undefined as string | undefined,
        output: undefined as string | undefined,
        index,
      }))

      // Helper to update metadata
      const updateMetadata = () => {
        ctx.metadata({
          title: `Map-Reduce: ${params.tasks.length} tasks`,
          metadata: {
            tasks: tracker.map((t) => ({
              id: t.id,
              description: t.description,
              subagent: t.subagent,
              sessionId: t.sessionId,
              status: t.status,
              error: t.error,
            })),
          },
        })
      }

      updateMetadata()

      // Calculate recursion depth to prevent infinite loops
      let depth = 0
      let currentID = ctx.sessionID
      while (true) {
        try {
          const session = await Session.get(currentID)
          if (!session.parentID) break
          depth++
          currentID = session.parentID
          if (depth > 10) break
        } catch {
          break
        }
      }

      // Allow recursion up to depth 3 (Main -> Level 1 -> Level 2 -> Level 3)
      const allowRecursion = depth < 3

      console.log(`[MapReduce] Session: ${ctx.sessionID} Depth: ${depth} AllowRecursion: ${allowRecursion}`)

      // Ask for permission for all tasks at once
      if (!ctx.extra?.bypassAgentCheck) {
        try {
          await ctx.ask({
            permission: "task",
            patterns: params.tasks.map((t) => t.subagent_type),
            always: ["*"],
            metadata: {
              description: `Execute ${params.tasks.length} tasks in parallel`,
              count: params.tasks.length,
            },
          })
        } catch (err: any) {
          const message = err.message || String(err)
          tracker.forEach((t) => {
            t.status = "error"
            t.error = message
          })
          updateMetadata()
          throw err
        }
      }

      // Execute tasks in parallel
      const results = await Promise.all(
        params.tasks.map(async (task, index) => {
          const track = tracker[index]

          try {
            const agent = await Agent.get(task.subagent_type)
            if (!agent) throw new Error(`Unknown agent type: ${task.subagent_type}`)

            const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")

            // Create session
            const session = await Session.create({
              parentID: ctx.sessionID,
              title: task.description + ` (@${agent.name} subagent)`,
              permission: [
                { permission: "todowrite", pattern: "*", action: "deny" },
                { permission: "todoread", pattern: "*", action: "deny" },
                ...(allowRecursion
                  ? ([
                      { permission: "map_reduce" as const, pattern: "*" as const, action: "allow" as const },
                      { permission: "task" as const, pattern: "*" as const, action: "allow" as const }, // Needed to spawn sub-sub-agents
                    ] as const)
                  : !hasTaskPermission
                    ? [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]
                    : []),
                ...(config.experimental?.primary_tools?.map((t) => ({
                  pattern: "*",
                  action: "allow" as const,
                  permission: t,
                })) ?? []),
              ],
            })

            track.sessionId = session.id
            track.status = "running"
            updateMetadata()

            const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
            if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

            const model = agent.model ?? {
              modelID: msg.info.modelID,
              providerID: msg.info.providerID,
            }

            const messageID = Identifier.ascending("message")

            // Handle cancellation
            function cancel() {
              SessionPrompt.cancel(session.id)
            }
            ctx.abort.addEventListener("abort", cancel)
            using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))

            const promptParts = await SessionPrompt.resolvePromptParts(task.prompt)

            const result = await SessionPrompt.prompt({
              messageID,
              sessionID: session.id,
              model: {
                modelID: model.modelID,
                providerID: model.providerID,
              },
              agent: agent.name,
              tools: {
                todowrite: false,
                todoread: false,
                map_reduce: !allowRecursion ? false : true,
                ...(hasTaskPermission ? {} : { task: false }),
                ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
              },
              parts: promptParts,
            })

            const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""
            track.output = text
            track.status = "completed"
            updateMetadata()

            return text
          } catch (e: any) {
            track.status = "error"
            track.error = e.message
            updateMetadata()
            return `Task failed: ${e.message}`
          }
        }),
      )

      const output = results
        .map((res, i) => `## Task ${i + 1}: ${params.tasks[i].description}\n\n${res}`)
        .join("\n\n---\n\n")

      return {
        title: `Completed ${params.tasks.length} tasks`,
        metadata: {
          tasks: tracker.map((t) => ({
            id: t.id,
            description: t.description,
            subagent: t.subagent,
            sessionId: t.sessionId,
            status: t.status,
            error: t.error,
          })),
        },
        output,
      }
    },
  }
})
