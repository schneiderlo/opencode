import type { CouncilSchema } from "./schema"

export namespace CouncilReport {
  function block(title: string, lines: string[]) {
    const body = lines.filter(Boolean).join("\n")
    return body ? `## ${title}\n${body}\n` : ""
  }

  function bullets(items: string[]) {
    return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None recorded"
  }

  export function render(input: {
    query: string
    plan: CouncilSchema.Plan
    results: Array<{
      task: CouncilSchema.Task
      result: CouncilSchema.Result
      json: string
      md: string
    }>
    debates: Array<CouncilSchema.Debate & { json: string; md?: string }>
    synth: CouncilSchema.Synthesis
  }) {
    const sections = [
      `# Council Report: ${input.plan.topic}\n`,
      block("Original Query", [input.query]),
      block("Executive Summary", [input.plan.summary, "", input.synth.recommendation]),
      block(
        "Perspectives Consulted",
        input.results.flatMap((item) => [
          `### ${item.task.persona.name}`,
          item.task.persona.description,
          "",
          `Focus: ${item.task.persona.focus.join(", ")}`,
          `Questions: ${item.task.persona.questions.join(" | ")}`,
          `Artifacts: \`${item.json}\`, \`${item.md}\``,
          "",
        ]),
      ),
      block(
        "Detailed Findings",
        input.results.flatMap((item) => [
          `### ${item.result.perspective}`,
          item.result.executive_summary,
          "",
          "Findings:",
          bullets(item.result.findings),
          "",
          "Recommendations:",
          bullets(item.result.recommendations),
          "",
          "Tradeoffs:",
          bullets(item.result.tradeoffs),
          "",
          "Unknowns:",
          bullets(item.result.unknowns),
          "",
        ]),
      ),
      input.debates.length
        ? block(
            "Debate Summary",
            input.debates.flatMap((item) => [
              `### ${item.topic}`,
              item.summary,
              "",
              `Participants: ${item.participants.map((entry) => entry.name).join(", ")}`,
              `Rounds: ${item.rounds.length}`,
              "",
              "Agreements:",
              bullets(item.agreements),
              "",
              "Disagreements:",
              bullets(item.disagreements),
              "",
              `Artifacts: \`${item.json}\`${item.md ? `, \`${item.md}\`` : ""}`,
              "",
            ]),
          )
        : "",
      block("Areas of Agreement", [bullets(input.synth.agreements)]),
      block("Areas of Disagreement", [bullets(input.synth.disagreements)]),
      block("Recommendation", [input.synth.recommendation, "", "Rationale:", bullets(input.synth.rationale)]),
      block("Trade-offs to Consider", [bullets(input.synth.tradeoffs)]),
      block("Next Steps", [bullets(input.synth.next_steps)]),
      block("Open Questions", [bullets(input.synth.open_questions)]),
    ]

    return sections.filter(Boolean).join("\n")
  }
}
