import z from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { Bus } from "../bus"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { work } from "@/util/queue"
import DESCRIPTION from "./heavy-plan.txt"

interface SubTask {
    id: number
    question: string
    deliverable: string
    context: string
}

interface TaskState {
    id: number
    question: string
    deliverable: string
    status: "pending" | "running" | "completed" | "error"
    sessionId?: string
    error?: string
    output?: string
}

export const HeavyPlanTool = Tool.define("heavy_plan", async () => {
    return {
        description: DESCRIPTION,
        parameters: z.object({
            sub_tasks: z
                .array(
                    z.object({
                        id: z.number().describe("Unique identifier for this sub-task"),
                        question: z.string().describe("The prompt/question for the sub-agent to answer"),
                        deliverable: z.string().describe("What the sub-agent should return"),
                        context: z
                            .string()
                            .describe(
                                "Specific system instructions/context for this sub-agent. This will be injected as system instructions.",
                            ),
                    }),
                )
                .min(1, "Provide at least one sub-task")
                .max(8, "Maximum 8 sub-tasks allowed")
                .describe("Array of independent sub-tasks to execute in parallel"),
        }),
        async execute(params, ctx) {
            const MAX_CONCURRENCY = 3
            const subTasks = params.sub_tasks

            // Initialize task states
            const taskStates: Map<number, TaskState> = new Map()
            for (const task of subTasks) {
                taskStates.set(task.id, {
                    id: task.id,
                    question: task.question,
                    deliverable: task.deliverable,
                    status: "pending",
                })
            }

            // Get parent message to find attachments to forward
            const parentMsg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
            if (parentMsg.info.role !== "assistant") throw new Error("Not an assistant message")

            // Find user message to get attachments
            const messages = await Session.messages({ sessionID: ctx.sessionID })
            const lastUserMessage = messages.findLast((m) => m.info.role === "user")
            const attachments = lastUserMessage?.parts.filter((p) => p.type === "file") ?? []

            // Update metadata with initial state
            const updateMetadata = () => {
                const states = Array.from(taskStates.values())
                const completed = states.filter((s) => s.status === "completed").length
                const failed = states.filter((s) => s.status === "error").length
                const total = states.length

                ctx.metadata({
                    title: `Heavy Plan (${completed}/${total}${failed > 0 ? `, ${failed} failed` : ""})`,
                    metadata: {
                        sub_tasks: states,
                        progress: {
                            completed,
                            failed,
                            total,
                        },
                    },
                })
            }

            updateMetadata()

            // Track child sessions for cancellation
            const childSessions: string[] = []
            const cancelAllChildren = () => {
                for (const sessionId of childSessions) {
                    SessionPrompt.cancel(sessionId)
                }
            }

            // Listen for abort signal
            ctx.abort.addEventListener("abort", cancelAllChildren)
            using _ = defer(() => ctx.abort.removeEventListener("abort", cancelAllChildren))

            // Process sub-tasks with concurrency control
            const results: Array<{
                id: number
                success: boolean
                output?: string
                sessionId?: string
                error?: string
                diffs?: Awaited<ReturnType<typeof Session.diff>>
            }> = []

            await work(MAX_CONCURRENCY, [...subTasks], async (task) => {
                if (ctx.abort.aborted) return

                // Update task state to running
                taskStates.set(task.id, {
                    ...taskStates.get(task.id)!,
                    status: "running",
                })
                updateMetadata()

                try {
                    // Create child session
                    const childSession = await Session.create({
                        parentID: ctx.sessionID,
                        title: `Sub-task ${task.id}: ${task.deliverable}`,
                    })
                    childSessions.push(childSession.id)

                    taskStates.set(task.id, {
                        ...taskStates.get(task.id)!,
                        sessionId: childSession.id,
                    })
                    updateMetadata()

                    // Subscribe to child session updates for live progress
                    const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
                        if (evt.properties.part.sessionID !== childSession.id) return
                        if (evt.properties.part.type !== "tool") return

                        // Update metadata with latest tool activity
                        updateMetadata()
                    })

                    // Get build agent for the child session
                    const agent = await Agent.get("build")
                    if (!agent) throw new Error("Build agent not found")

                    // Prepare parts with question and forwarded attachments
                    const parts: SessionPrompt.PromptInput["parts"] = [
                        {
                            type: "text",
                            text: task.question,
                        },
                        ...attachments.map((att) => ({
                            type: "file" as const,
                            url: att.url,
                            filename: att.filename,
                            mime: att.mime,
                        })),
                    ]

                    const config = await Config.get()

                    // Call SessionPrompt.prompt with system context and disabled heavy_plan tool
                    const messageID = Identifier.ascending("message")
                    const result = await SessionPrompt.prompt({
                        messageID,
                        sessionID: childSession.id,
                        model: {
                            modelID: parentMsg.info.modelID,
                            providerID: parentMsg.info.providerID,
                        },
                        agent: "build",
                        system: task.context, // Inject the sub-task context as system prompt
                        tools: {
                            heavy_plan: false, // Disable heavy_plan to prevent recursion
                            todowrite: false,
                            todoread: false,
                            task: false,
                            ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
                        },
                        parts,
                    })

                    unsub()

                    // Get session diffs
                    const diffs = await Session.diff(childSession.id)

                    // Extract text output
                    const textOutput = result.parts.findLast((p) => p.type === "text")?.text ?? ""

                    // Mark task as completed
                    taskStates.set(task.id, {
                        ...taskStates.get(task.id)!,
                        status: "completed",
                        output: textOutput.slice(0, 500), // Truncate for metadata
                    })
                    updateMetadata()

                    results.push({
                        id: task.id,
                        success: true,
                        output: textOutput,
                        sessionId: childSession.id,
                        diffs,
                    })
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error)

                    taskStates.set(task.id, {
                        ...taskStates.get(task.id)!,
                        status: "error",
                        error: errorMessage,
                    })
                    updateMetadata()

                    results.push({
                        id: task.id,
                        success: false,
                        error: errorMessage,
                    })
                }
            })

            // Sort results by id
            results.sort((a, b) => a.id - b.id)

            // Aggregate outputs
            const successful = results.filter((r) => r.success)
            const failed = results.filter((r) => !r.success)

            // Build output summary
            let output = "# Heavy Plan Execution Summary\n\n"

            if (successful.length > 0) {
                output += `## Completed Sub-tasks (${successful.length}/${results.length})\n\n`
                for (const result of successful) {
                    const task = subTasks.find((t) => t.id === result.id)!
                    output += `### Sub-task ${result.id}: ${task.deliverable}\n`
                    output += `**Session ID:** ${result.sessionId}\n\n`
                    output += `**Output:**\n${result.output}\n\n`

                    if (result.diffs && result.diffs.length > 0) {
                        output += `**Files Modified:**\n`
                        for (const diff of result.diffs) {
                            output += `- ${diff.file}\n`
                        }
                        output += "\n"
                    }
                }
            }

            if (failed.length > 0) {
                output += `## Failed Sub-tasks (${failed.length}/${results.length})\n\n`
                for (const result of failed) {
                    const task = subTasks.find((t) => t.id === result.id)!
                    output += `### Sub-task ${result.id}: ${task.deliverable}\n`
                    output += `**Error:** ${result.error}\n\n`
                }
            }

            // Aggregate all diffs
            const allDiffs = results.flatMap((r) => r.diffs ?? [])
            const uniqueFiles = [...new Set(allDiffs.map((d) => d.file))]

            if (uniqueFiles.length > 0) {
                output += `## All Modified Files\n\n`
                for (const file of uniqueFiles) {
                    output += `- ${file}\n`
                }
            }

            return {
                title: `Heavy Plan (${successful.length}/${results.length} completed)`,
                metadata: {
                    sub_tasks: Array.from(taskStates.values()),
                    progress: {
                        completed: successful.length,
                        failed: failed.length,
                        total: results.length,
                    },
                    sessions: results.filter((r) => r.sessionId).map((r) => r.sessionId),
                    modified_files: uniqueFiles,
                },
                output,
            }
        },
    }
})
