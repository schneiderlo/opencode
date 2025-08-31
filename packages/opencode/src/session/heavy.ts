import { z } from "zod"
import {
  generateText,
  generateObject,
  streamText,
  type ModelMessage,
  type LanguageModelUsage,
  type ProviderMetadata,
} from "ai"
import { Decimal } from "decimal.js"
import type { ModelsDev } from "../provider/models"

import PROMPT_HEAVY_PLANNER from "./prompt/heavy_planner.txt"
import PROMPT_HEAVY_SYNTHESIZER from "./prompt/heavy_synthesizer.txt"
import PROMPT_JSON_INSTRUCTION from "./prompt/json_instruction.txt"

import { Bus } from "../bus"
import { Config } from "../config/config"
import { Provider } from "../provider/provider"
import { ProviderTransform } from "../provider/transform"
import { MessageV2 } from "./message-v2"
import { Identifier } from "../id/id"
import { NamedError } from "../util/error"
import { ToolRegistry } from "../tool/registry"
import { SystemPrompt } from "./system"
import { Log } from "../util/log"
import { Storage } from "../storage/storage"
import { Session } from "./index"

const log = Log.create({ service: "session" })

function getUsage(model: ModelsDev.Model, usage: LanguageModelUsage, metadata?: ProviderMetadata) {
  const tokens = {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    reasoning: usage?.reasoningTokens ?? 0,
    cache: {
      write: (metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
        // @ts-expect-error
        metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
        0) as number,
      read: usage.cachedInputTokens ?? 0,
    },
  }
  return {
    cost: new Decimal(0)
      .add(new Decimal(tokens.input).mul(model.cost?.input ?? 0).div(1_000_000))
      .add(new Decimal(tokens.output).mul(model.cost?.output ?? 0).div(1_000_000))
      .add(new Decimal(tokens.cache.read).mul(model.cost?.cache_read ?? 0).div(1_000_000))
      .add(new Decimal(tokens.cache.write).mul(model.cost?.cache_write ?? 0).div(1_000_000))
      .toNumber(),
    tokens,
  }
}


// --- Internal helper functions ---
async function updateMessage(msg: MessageV2.Info) {
  await Storage.writeJSON("session/message/" + msg.sessionID + "/" + msg.id, msg)
  Bus.publish(MessageV2.Event.Updated, {
    info: msg,
  })
}

async function updatePart(part: MessageV2.Part) {
  await Storage.writeJSON(["session", "part", part.sessionID, part.messageID, part.id].join("/"), part)
  Bus.publish(MessageV2.Event.PartUpdated, {
    part,
  })
  return part
}

async function getParts(sessionID: string, messageID: string) {
  const result = [] as MessageV2.Part[]
  for (const item of await Storage.list("session/part/" + sessionID + "/" + messageID)) {
    const read = await Storage.readJSON<MessageV2.Part>(item)
    result.push(read)
  }
  result.sort((a, b) => (a.id > b.id ? 1 : -1))
  return result
}

// --- Types and Zod Schemas ---
const PlannerSubTask = z
  .object({
    id: z.number(),
    question: z.string(),
    deliverable: z.string(),
  })
  .strict()

const PlannerOutputSchema = z
  .object({
    original_query: z.string(),
    sub_tasks: z.array(PlannerSubTask),
  })
  .strict()

export type PlannerOutput = z.infer<typeof PlannerOutputSchema>

export type ExecutorTaskResult = {
  taskId: number
  childSessionID: string
  providerID: string
  modelID: string
  status: "completed" | "failed"
  report?: string
  error?: string
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
}

// --- Events ---
export const Heavy = {
  PlanGenerated: Bus.event(
    "heavy.plan.generated",
    z.object({ sessionID: z.string(), plan: PlannerOutputSchema }),
  ),
  TaskStarted: Bus.event(
    "heavy.task.started",
    z.object({ sessionID: z.string(), taskId: z.number(), question: z.string(), model: z.string(), childSessionID: z.string() }),
  ),
  TaskCompleted: Bus.event(
    "heavy.task.completed",
    z.object({ sessionID: z.string(), taskId: z.number(), report: z.string(), childSessionID: z.string() }),
  ),
  TaskFailed: Bus.event(
    "heavy.task.failed",
    z.object({ sessionID: z.string(), taskId: z.number(), error: z.string(), childSessionID: z.string() }),
  ),
  SynthesisStarted: Bus.event("heavy.synthesis.started", z.object({ sessionID: z.string() })),
  SynthesisCompleted: Bus.event("heavy.synthesis.completed", z.object({ sessionID: z.string() })),
}

// --- State and Input Types ---
export type HeavyState = {
  heavyPlan: Map<string, PlannerOutput>
  heavyApproval: Map<string, (approved: boolean) => void>
  heavyResults: Map<string, ExecutorTaskResult[]>
}

export type RunHeavyWorkflowArgs = {
  input: Session.ChatInput
  assistantMsg: MessageV2.Assistant
  abortSignal: globalThis.AbortSignal
  state: HeavyState
  processor: any // The processor from createProcessor function
}

// --- Internal Helper Functions ---
async function _runPlannerAgent(input: Session.ChatInput): Promise<{
  plan: PlannerOutput
  cost: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cache: {
      read: number
      write: number
    }
  }
}> {
  const cfg = await Config.get()
  const heavy = cfg.heavy

  const { providerID: fallbackProviderID, modelID: fallbackModelID } = input
  const plannerModelStr = heavy?.planner_model

  let providerID = fallbackProviderID
  let modelID = fallbackModelID
  if (plannerModelStr) {
    try {
      const parsed = Provider.parseModel(plannerModelStr)
      providerID = parsed.providerID
      modelID = parsed.modelID
    } catch (e) {
      log.warn("planner.parseModel.failed; falling back to current model", {
        error: (e as Error)?.message,
      })
    }
  }

  const { language, info } = await Provider.getModel(providerID, modelID)

  const originalQuery = input.parts
    .filter((p) => p.type === "text")
    .map((p: any) => p.text as string)
    .join("\n\n")

  const system = [
    ...SystemPrompt.header(providerID),
    PROMPT_HEAVY_PLANNER,
  ]

  // First attempt: structured object generation
  try {
    const res = await generateObject({
      model: language,
      schema: PlannerOutputSchema,
      prompt: [
        ...system.map(
          (x): ModelMessage => ({
            role: "system",
            content: x,
          }),
        ),
        {
          role: "user",
          content: originalQuery || "",
        },
      ],
      temperature: 0,
    })

    // Some providers may return stringified JSON despite schema; handle it
    const object: unknown = (res as any).object
    const usage = getUsage(info, res.usage, res.providerMetadata)
    if (typeof object === "string") {
      // Some providers return a raw JSON string even when using generateObject; log raw content
      try {
        log.info("planner.object_string", { raw: object, repr: JSON.stringify(object) })
      } catch {}
      const parsed = JSON.parse(object)
      const validated = PlannerOutputSchema.parse(parsed)
      return { plan: validated, ...usage }
    }
    return { plan: object as PlannerOutput, ...usage }
  } catch (e) {
    log.warn("planner.generateObject.failed", { error: (e as Error)?.message })
  }

  // Fallback: text generation that returns JSON; extract and validate
  const textResult = await generateText({
    model: language,
    providerOptions: {
      [providerID]: {
        ...info.options,
        ...ProviderTransform.options(providerID, modelID, input.sessionID),
      },
    },
    messages: [
      ...system.map(
        (x): ModelMessage => ({
          role: "system",
          content: x + "\n" + PROMPT_JSON_INSTRUCTION,
        }),
      ),
      {
        role: "user",
        content: [
          {
            type: "text",
            text: originalQuery || "",
          },
        ],
      },
    ],
    maxOutputTokens: 4000,
    temperature: 0,
  })

  const raw = textResult.text ?? ""
  try {
    // Log the exact raw text returned by the model and a JSON-escaped representation
    log.info("planner.raw_text", { raw, repr: JSON.stringify(raw) })
  } catch {}

  function extractJSONObject(input: string): any {
    const start = input.indexOf("{")
    if (start === -1) return undefined
    let depth = 0
    for (let i = start; i < input.length; i++) {
      const ch = input[i]
      if (ch === "{") depth++
      if (ch === "}") {
        depth--
        if (depth === 0) {
          const slice = input.slice(start, i + 1)
          try {
            return JSON.parse(slice)
          } catch {}
        }
      }
    }
    return undefined
  }

  const parsed = extractJSONObject(raw)
  const validated = PlannerOutputSchema.safeParse(parsed)
  const usage = getUsage(info, textResult.usage, textResult.providerMetadata)
  if (validated.success) {
    return { plan: validated.data, ...usage }
  }

  throw new Error("Planner could not generate a valid plan")
}

// Attempts to get the planner's raw text output for debugging/UX when parsing fails
async function _generatePlannerRawText(input: Session.ChatInput): Promise<string | undefined> {
  try {
    const cfg = await Config.get()
    const heavy = cfg.heavy
    const { providerID: fallbackProviderID, modelID: fallbackModelID } = input
    const plannerModelStr = heavy?.planner_model

    let providerID = fallbackProviderID
    let modelID = fallbackModelID
    if (plannerModelStr) {
      try {
        const parsed = Provider.parseModel(plannerModelStr)
        providerID = parsed.providerID
        modelID = parsed.modelID
      } catch {}
    }

    const { language, info } = await Provider.getModel(providerID, modelID)

    const originalQuery = input.parts
      .filter((p) => p.type === "text")
      .map((p: any) => p.text as string)
      .join("\n\n")

    const system = [
      ...SystemPrompt.header(providerID),
      PROMPT_HEAVY_PLANNER,
    ]

    const textResult = await generateText({
      model: language,
      providerOptions: {
        [providerID]: {
          ...info.options,
          ...ProviderTransform.options(providerID, modelID, input.sessionID),
        },
      },
      messages: [
        ...system.map(
          (x): ModelMessage => ({
            role: "system",
            content: x + "\n" + PROMPT_JSON_INSTRUCTION,
          }),
        ),
        {
          role: "user",
          content: [
            { type: "text", text: originalQuery || "" },
          ],
        },
      ],
      maxOutputTokens: 800,
      temperature: 0,
    })
    return textResult.text ?? ""
  } catch {
    return undefined
  }
}

export async function runWithConcurrency<T, R>(
  items: T[],
  maxConcurrent: number,
  work: (item: T, index: number) => Promise<R>,
) {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const worker = async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) break
      results[index] = await work(items[index]!, index)
    }
  }
  const workers = Array.from({ length: Math.min(maxConcurrent, Math.max(1, items.length)) }, () => worker())
  await Promise.all(workers)
  return results
}

// Helper function to format all parts for full text output
function _formatPartsForFullText(parts: MessageV2.Part[]): string {
  const output: string[] = []
  for (const part of parts) {
    switch (part.type) {
      case "text":
        if (part.text && part.text.trim().length > 0) output.push(part.text)
        break
      case "tool":
        // Format tool usage information
        const toolInfo = `> Tool: \`${part.tool}\` (${part.state.status})`
        if (part.state.status === "completed") {
          output.push(`${toolInfo}\nOutput: \`\`\`\n${part.state.output}\n\`\`\``)
        } else if (part.state.status === "error") {
          output.push(`${toolInfo}\nError: ${part.state.error}`)
        } else {
          output.push(toolInfo)
        }
        break
      case "reasoning":
        if (part.text && part.text.trim().length > 0) {
          output.push(`> Reasoning: ${part.text}`)
        }
        break
      // Other part types can be added here if needed
    }
  }
  return output.join("\n\n")
}

async function _runExecutorAgents(
  plan: PlannerOutput,
  sessionID: string,
  providerID: string,
  modelID: string,
): Promise<ExecutorTaskResult[]> {
  const cfg = await Config.get()
  const limit = Math.max(1, cfg.heavy?.max_concurrent_agents ?? 3)
  // Read the new config value
  const subAgentOutputMode = cfg.heavy?.sub_agent_output ?? "report"
  log.info("executor.start", { sessionID, total: plan.sub_tasks.length, limit })

  const pool = (() => {
    const list = cfg.heavy?.agent_pool_models ?? []
    const parsed: { providerID: string; modelID: string }[] = []
    for (const item of list) {
      try {
        const m = Provider.parseModel(item)
        parsed.push({ providerID: m.providerID, modelID: m.modelID })
      } catch (e) {
        log.warn("executor.pool.parse.fail", { model: item, error: (e as Error)?.message })
      }
    }
    return parsed
  })()

  const results = await runWithConcurrency(plan.sub_tasks, limit, async (task, index) => {
    const pick = pool.length ? pool[index % pool.length] : { providerID, modelID }
    const child = await Session.create(sessionID)
    log.info("executor.task.start", { sessionID, childID: child.id, taskId: task.id, providerID: pick.providerID, modelID: pick.modelID })
    await Bus.publish(Heavy.TaskStarted, {
      sessionID,
      taskId: task.id,
      question: task.question,
      model: `${pick.providerID}/${pick.modelID}`,
      childSessionID: child.id,
    })
    try {
      const heavyTools = cfg.heavy?.tools
      const toolOverrides: Record<string, boolean> = {}
      if (heavyTools?.read_only) {
        for (const id of ["edit", "write", "patch", "bash", "todowrite"]) {
          toolOverrides[id] = false
        }
      }
      if (Array.isArray(heavyTools?.allowed_tools) && heavyTools!.allowed_tools!.length) {
        const all = ToolRegistry.ids()
        const allowed = new Set(heavyTools!.allowed_tools!)
        for (const id of all) {
          if (!allowed.has(id)) toolOverrides[id] = false
        }
      }
      if (Array.isArray(heavyTools?.denied_tools)) {
        for (const id of heavyTools!.denied_tools!) toolOverrides[id] = false
      }
      const result = await Session.chat({
        sessionID: child.id,
        providerID: pick.providerID,
        modelID: pick.modelID,
        tools: Object.keys(toolOverrides).length ? toolOverrides : undefined,
        parts: [
          {
            type: "text",
            text: task.question,
          },
        ],
      })
      const reportText = (() => {
        // If user wants full text, format all parts
        if (subAgentOutputMode === "full_text") {
          return _formatPartsForFullText(result.parts)
        }
        
        // Otherwise, use the original logic for a concise report
        const text = result.parts.find((p: MessageV2.Part) => p.type === "text") as MessageV2.TextPart | undefined
        return text?.text ?? ""
      })()
      await Bus.publish(Heavy.TaskCompleted, { sessionID, taskId: task.id, report: reportText, childSessionID: child.id })
      log.info("executor.task.done", { childID: child.id, taskId: task.id })
      return {
        taskId: task.id,
        childSessionID: child.id,
        providerID: pick.providerID,
        modelID: pick.modelID,
        status: "completed" as const,
        report: reportText,
        cost: result.info.cost,
        tokens: result.info.tokens,
      }
    } catch (e) {
      const msg = (e as Error)?.message ?? "unknown"
      await Bus.publish(Heavy.TaskFailed, { sessionID, taskId: task.id, error: msg, childSessionID: child.id })
      log.error("executor.task.error", { childID: child.id, taskId: task.id, error: msg })
      const failed: ExecutorTaskResult = {
        taskId: task.id,
        childSessionID: child.id,
        providerID: pick.providerID,
        modelID: pick.modelID,
        status: "failed",
        error: msg,
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
      }
      return failed
    }
    
  })

  log.info("executor.end", { sessionID })
  return results
}

async function _runSynthesizerAgent(args: {
  plan: PlannerOutput
  assistantMsg: MessageV2.Assistant
  sessionID: string
  inputProviderID: string
  inputModelID: string
  reports: string[]
  abortSignal: AbortSignal
}) {
  const { plan, assistantMsg, sessionID, inputProviderID, inputModelID, reports, abortSignal } = args
  await Bus.publish(Heavy.SynthesisStarted, { sessionID })

  const cfg = await Config.get()
  const synth = cfg.heavy?.synthesizer_model
  let providerID = inputProviderID
  let modelID = inputModelID
  if (synth) {
    try {
      const parsed = Provider.parseModel(synth)
      providerID = parsed.providerID
      modelID = parsed.modelID
    } catch {}
  }

  const model = await Provider.getModel(providerID, modelID)
  assistantMsg.providerID = providerID
  assistantMsg.modelID = modelID
  await updateMessage(assistantMsg)

  const systemText = PROMPT_HEAVY_SYNTHESIZER
  const userText =
    `ORIGINAL QUERY:\n${plan.original_query}\n\nREPORTS:\n` +
    (reports.length
      ? reports.map((r, i) => `[REPORT ${i + 1} from Task ${i + 1}]:\n${r}`).join("\n\n---\n\n")
      : "[No successful reports were generated by the executor agents.]")

  const stream = streamText({
    maxRetries: 10,
    abortSignal,
    model: model.language,
    messages: [
      { role: "system", content: systemText },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: userText,
          },
        ],
      },
    ],
  })

  return stream
}

// --- The Main Exported Workflow Function ---
export async function runHeavyWorkflow(
  args: RunHeavyWorkflowArgs,
): Promise<{ info: MessageV2.Assistant; parts: MessageV2.Part[] }> {
  const { input, assistantMsg, abortSignal, state, processor } = args

  try {
    const plannerResult = await _runPlannerAgent(input)
    const plan = plannerResult.plan
    assistantMsg.cost += plannerResult.cost
    assistantMsg.tokens.input += plannerResult.tokens.input
    assistantMsg.tokens.output += plannerResult.tokens.output
    // reflect planner model if configured
    const cfg = await Config.get()
    const plannerModelStr = cfg.heavy?.planner_model
    if (plannerModelStr) {
      try {
        const parsed = Provider.parseModel(plannerModelStr)
        assistantMsg.providerID = parsed.providerID
        assistantMsg.modelID = parsed.modelID
      } catch {}
    }
    state.heavyPlan.set(input.sessionID, plan)
    await Bus.publish(Heavy.PlanGenerated, { sessionID: input.sessionID, plan })

    const approved = await new Promise<boolean>((resolve) => {
      state.heavyApproval.set(input.sessionID, resolve)
    })

    if (approved) {
      const part: MessageV2.Part = {
        id: Identifier.ascending("part"),
        messageID: assistantMsg.id,
        sessionID: input.sessionID,
        type: "heavy_plan",
        plan: plan,
      }
      await updatePart(part)
      const execResults = await _runExecutorAgents(
        plan,
        input.sessionID,
        input.providerID,
        input.modelID,
      )
      const reports = execResults
        .filter((r) => r.status === "completed")
        .map((r) => r.report ?? "")
        .filter((x) => x && x.trim().length > 0)

      const stream = await _runSynthesizerAgent({
        plan,
        assistantMsg,
        sessionID: input.sessionID,
        inputProviderID: input.providerID,
        inputModelID: input.modelID,
        reports,
        abortSignal,
      })
      await processor.process(stream)
      // Emit synthesis completed event
      await Bus.publish(Heavy.SynthesisCompleted, { sessionID: input.sessionID })
      // Now create the summary message
      const summaryMsg: MessageV2.Assistant = {
        id: Identifier.ascending("message"),
        role: "assistant",
        sessionID: input.sessionID,
        time: {
          created: Date.now(),
          completed: Date.now(),
        },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: assistantMsg.modelID,
        providerID: assistantMsg.providerID,
        system: [],
        mode: "heavy",
        path: {
          cwd: "",
          root: "",
        },
        level: "warning",
      }
      await updateMessage(summaryMsg)
      const subAgentCost = execResults.reduce((acc, r) => acc + r.cost, 0)
      const subAgentTokens = execResults.reduce(
        (acc, r) => {
          acc.input += r.tokens.input
          acc.output += r.tokens.output
          return acc
        },
        { input: 0, output: 0 },
      )
      const totalCost = assistantMsg.cost + subAgentCost
      const totalInputTokens = assistantMsg.tokens.input + subAgentTokens.input
      const totalOutputTokens = assistantMsg.tokens.output + subAgentTokens.output
      const totalTokens = totalInputTokens + totalOutputTokens
      const summaryText = `
| Stage | Cost | Tokens (Input/Output) |
| :--- | :--- | :--- |
| Planner | $${plannerResult.cost.toFixed(4)} | ${
        plannerResult.tokens.input + plannerResult.tokens.output
      } (${plannerResult.tokens.input}/${plannerResult.tokens.output}) |
| Sub-agents | $${subAgentCost.toFixed(4)} | ${subAgentTokens.input + subAgentTokens.output} (${
        subAgentTokens.input
      }/${subAgentTokens.output}) |
| Synthesizer | $${assistantMsg.cost.toFixed(4)} | ${
        assistantMsg.tokens.input + assistantMsg.tokens.output
      } (${assistantMsg.tokens.input}/${assistantMsg.tokens.output}) |
| **Total** | **$${totalCost.toFixed(4)}** | **${totalTokens} (${totalInputTokens}/${totalOutputTokens})** |
`
      const summaryPart: MessageV2.Part = {
        id: Identifier.ascending("part"),
        messageID: summaryMsg.id,
        sessionID: input.sessionID,
        type: "text",
        text: summaryText,
      }
      await updatePart(summaryPart)
    } else {
      const part: MessageV2.Part = {
        id: Identifier.ascending("part"),
        messageID: assistantMsg.id,
        sessionID: input.sessionID,
        type: "text",
        text: "Plan rejected by user.",
      }
      await updatePart(part)
    }

    // Completion time is set by the streaming processor during synthesis.
    const parts = await getParts(assistantMsg.sessionID, assistantMsg.id)
    return { info: assistantMsg, parts }
  } catch (e) {
    const raw = await _generatePlannerRawText(input)
    if (raw && raw.trim().length > 0) {
      const part: MessageV2.Part = {
        id: Identifier.ascending("part"),
        messageID: assistantMsg.id,
        sessionID: input.sessionID,
        type: "text",
        text: "Planner output (unparsed):\n" + raw,
      }
      await updatePart(part)
    }
    assistantMsg.error = new NamedError.Unknown({ message: (e as Error)?.message ?? "planner failed" }).toObject()
    assistantMsg.time.completed = Date.now()
    await updateMessage(assistantMsg)
    const parts = await getParts(assistantMsg.sessionID, assistantMsg.id)
    return { info: assistantMsg, parts }
  }
}
