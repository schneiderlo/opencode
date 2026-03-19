import { HeavyService } from "../heavy/service"
import DESCRIPTION from "./heavy_run.txt"
import { Tool } from "./tool"

export const HeavyRunTool = Tool.define("heavy_run", {
  description: DESCRIPTION,
  parameters: HeavyService.Input,
  async execute(input, ctx) {
    const out = await HeavyService.execute({
      input,
      ctx,
    })

    const output = [
      `Heavy report: ${out.reportPath}`,
      `Artifacts: ${out.dir}`,
      `Nested runs: ${out.paths.nested.length}`,
      "",
      "Tasks:",
      ...out.plan.tasks.map((item) => `- ${item.title} (${item.agent}, ${item.mode})`),
      "",
      "Answer:",
      out.synth.answer,
      "",
      "Key points:",
      ...(out.synth.key_points.length ? out.synth.key_points : ["None recorded"]).map((item) => `- ${item}`),
      "",
      "Next steps:",
      ...(out.synth.next_steps.length ? out.synth.next_steps : ["None recorded"]).map((item) => `- ${item}`),
    ].join("\n")

    return {
      title: "Heavy analysis complete",
      metadata: {
        stage: "completed",
        dir: out.dir,
        depth: input.depth,
        reportPath: out.reportPath,
        artifactDir: out.dir,
        planPath: out.paths.plan,
        taskPaths: out.paths.tasks,
        nestedPaths: out.paths.nested,
        synthesisPath: out.paths.synthesis,
        tasks: out.states,
        taskPlan: out.plan.tasks.map((item) => ({ title: item.title, agent: item.agent, mode: item.mode })),
      },
      output,
    }
  },
})
