import { CouncilSchema } from "./schema"

export namespace CouncilDebate {
  export function select(input: { plan: CouncilSchema.Plan; results: Array<CouncilSchema.Result> }) {
    return input.plan.debate_topics
      .map((topic) => ({
        topic,
        participants: input.results
          .filter((item) =>
            item.findings.some((line) => line.toLowerCase().includes(topic.toLowerCase())) ||
            item.recommendations.some((line) => line.toLowerCase().includes(topic.toLowerCase())),
          )
          .slice(0, 3)
          .map((item) => ({
            name: item.perspective,
            position: [item.executive_summary, ...item.recommendations].join("\n"),
          })),
      }))
      .filter((item) => item.participants.length >= 2)
  }
}
