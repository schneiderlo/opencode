import { CouncilService } from "../council/service"
import DESCRIPTION from "./council_run.txt"
import * as Tool from "./tool"
import { Effect } from "effect"
import z from "zod"

type Metadata = Record<string, unknown>

export const CouncilRunTool = Tool.define<typeof CouncilService.Input, Metadata, never>(
  "council_run",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: CouncilService.Input,
    execute: (input: z.infer<typeof CouncilService.Input>, ctx: Tool.Context<Metadata>) =>
      Effect.gen(function* () {
        const out = yield* CouncilService.execute({
          input,
          ctx,
        })

        const output = [
          `Council report: ${out.reportPath}`,
          `Visual report: ${out.reportHtmlPath}`,
          `Artifacts: ${out.dir}`,
          "",
          "Perspectives:",
          ...out.plan.perspectives.map((item) => `- ${item.name}`),
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
            stage: "completed",
            dir: out.dir,
            reportPath: out.reportPath,
            reportHtmlPath: out.reportHtmlPath,
            artifactDir: out.dir,
            planPath: out.paths.plan,
            perspectivePaths: out.paths.perspectives,
            debatePaths: out.paths.debates,
            synthesisPath: out.paths.synthesis,
            perspectives: out.tracker.perspectives,
            debates: out.tracker.debates,
            perspectiveNames: out.plan.perspectives.map((item) => item.name),
            debateTopics: out.debates.map((item) => item.topic),
          },
          output,
        }
      }).pipe(Effect.orDie) as unknown as Effect.Effect<Tool.ExecuteResult<Metadata>>,
  }),
)
