import { CouncilService } from "../council/service"
import DESCRIPTION from "./council_run.txt"
import { Tool } from "./tool"

export const CouncilRunTool = Tool.define("council_run", {
  description: DESCRIPTION,
  parameters: CouncilService.Input,
  async execute(input, ctx) {
    const out = await CouncilService.execute({
      input,
      ctx,
    })

    const output = [
      `Council report: ${out.reportPath}`,
      `Artifacts: ${out.dir}`,
      "",
      "Recommendation:",
      out.synth.recommendation,
      "",
      "Rationale:",
      ...out.synth.rationale.map((item) => `- ${item}`),
      "",
      "Trade-offs:",
      ...(out.synth.tradeoffs.length ? out.synth.tradeoffs : ["None recorded"]).map((item) => `- ${item}`),
      "",
      "Next steps:",
      ...(out.synth.next_steps.length ? out.synth.next_steps : ["None recorded"]).map((item) => `- ${item}`),
    ].join("\n")

    return {
      title: "Council analysis complete",
      metadata: {
        reportPath: out.reportPath,
        artifactDir: out.dir,
        perspectives: out.plan.perspectives.map((item) => item.name),
        debates: out.debates.map((item) => item.topic),
      },
      output,
    }
  },
})
