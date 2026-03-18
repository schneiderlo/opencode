import type { HeavySchema } from "./schema"

export namespace HeavyReport {
  function bullets(items: string[]) {
    return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None recorded"
  }

  function block(title: string, lines: string[]) {
    const body = lines.filter(Boolean).join("\n")
    return body ? `## ${title}\n${body}\n` : ""
  }

  export function render(input: {
    query: string
    plan: HeavySchema.Plan
    tasks: Array<{
      task: HeavySchema.Plan["tasks"][number]
      result: HeavySchema.Result
      json: string
      md: string
    }>
    synth: HeavySchema.Synthesis
  }) {
    return [
      "# Heavy Report\n",
      block("Original Query", [input.query]),
      block("Summary", [input.synth.summary, "", input.synth.answer]),
      block(
        "Task Plan",
        input.plan.tasks.flatMap((item) => [
          `### ${item.title}`,
          `Agent: ${item.agent}`,
          `Goal: ${item.goal}`,
          `Deliverable: ${item.deliverable}`,
          "",
        ]),
      ),
      block(
        "Task Results",
        input.tasks.flatMap((item) => [
          `### ${item.result.title}`,
          item.result.summary,
          ...(item.result.details ? ["", item.result.details] : []),
          "",
          "Findings:",
          bullets(item.result.findings),
          "",
          "Next steps:",
          bullets(item.result.next_steps),
          "",
          `Artifacts: \`${item.json}\`, \`${item.md}\``,
          "",
        ]),
      ),
      block("Key Points", [bullets(input.synth.key_points)]),
      block("Next Steps", [bullets(input.synth.next_steps)]),
      block("Open Questions", [bullets(input.synth.open_questions)]),
    ].join("\n")
  }
}
