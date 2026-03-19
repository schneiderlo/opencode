import z from "zod"

const Task = z.object({
  id: z.string(),
  title: z.string(),
  mode: z.enum(["direct", "heavy"]).default("direct"),
  agent: z.enum(["explore", "general"]),
  goal: z.string(),
  prompt: z.string(),
  deliverable: z.string(),
})

export namespace HeavySchema {
  export const Plan = z
    .object({
      summary: z.string(),
      tasks: z.array(Task).min(2).max(6),
      synthesis_focus: z.array(z.string()).default([]),
    })
    .meta({
      ref: "HeavyPlan",
    })
  export type Plan = z.infer<typeof Plan>

  export const Result = z
    .object({
      task_id: z.string(),
      title: z.string(),
      summary: z.string(),
      details: z.string().default(""),
      findings: z.array(z.string()).default([]),
      next_steps: z.array(z.string()).default([]),
      nested: z
        .object({
          depth: z.number().int().min(0),
          dir: z.string(),
          report: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "HeavyTaskResult",
    })
  export type Result = z.infer<typeof Result>

  export const Synthesis = z
    .object({
      summary: z.string(),
      answer: z.string(),
      key_points: z.array(z.string()).default([]),
      next_steps: z.array(z.string()).default([]),
      open_questions: z.array(z.string()).default([]),
    })
    .meta({
      ref: "HeavySynthesis",
    })
  export type Synthesis = z.infer<typeof Synthesis>

  export const Paths = z
    .object({
      root: z.string(),
      request: z.string(),
      plan: z.string(),
      tasks: z.array(z.string()),
      synthesis: z.string(),
      report: z.string().optional(),
      report_html: z.string().optional(),
      nested: z.array(z.string()).default([]),
    })
    .meta({
      ref: "HeavyPaths",
    })
  export type Paths = z.infer<typeof Paths>

  export const Input = z.object({
    query: z.string(),
    context: z.array(z.string()).default([]),
    depth: z.number().int().min(0).default(0),
    max_depth: z.number().int().min(0).max(3).default(2),
  })
  export type Input = z.infer<typeof Input>
}
