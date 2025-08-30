# Explanation of Changes: Heavy Mode Usage Display

This document provides a detailed explanation of the changes made to display cost and token usage information for the "heavy mode" workflow.

## 1. What Was Done Precisely

The goal was to show the user the total cost and token usage after a heavy mode synthesis is complete, with a breakdown by phase. To achieve this, I implemented changes across the backend, the Go SDK, and the TUI frontend.

### Backend (`packages/opencode/src/session/heavy.ts`)

1.  **Usage Tracking:** I modified the core "heavy mode" logic to track token usage for each distinct phase of the operation:
    *   **Planner:** Captures the `promptTokens` and `completionTokens` from the initial planning agent.
    *   **Executor:** Accumulates the token usage from all the sub-agent tasks that are executed as part of the plan.
    *   **Synthesizer:** Captures the token usage from the final agent that synthesizes the reports into a cohesive response.

2.  **Cost Calculation:** I leveraged the existing `getUsage` utility within the codebase to calculate the monetary cost for each phase. This function computes the cost based on the specific model used and its corresponding token pricing (input and output).

3.  **Event Payload Update:** I updated the Zod schema for the `heavy.synthesis.completed` event to include the newly captured data. The event payload now contains a structured `usage` object with a detailed breakdown for the `planner`, `executor`, and `synthesizer` phases, including their respective token counts and calculated costs.

### Go SDK (`packages/sdk/go/event.go`)

*   **Manual SDK Update:** I manually updated the Go data structures corresponding to the `heavy.synthesis.completed` event. This was necessary to ensure the TUI could correctly parse the new, richer event payload from the backend. I defined new Go structs for `Usage`, `Planner`, `Executor`, and `Synthesizer` to match the updated schema.

### TUI Frontend (`packages/tui/`)

1.  **State Management (`internal/app/app.go`):**
    *   I introduced a `HeavyUsage` struct to the main application state (`app.App`). This new field serves as the container for the usage and cost details when they are received from the backend.

2.  **Event Handling (`internal/tui/tui.go`):**
    *   I modified the event handler for `heavy.synthesis.completed`. The handler now extracts the detailed usage breakdown from the event properties and populates the `app.HeavyUsage` state field.

3.  **Display Logic (`internal/components/chat/messages.go`):**
    *   I created a new `renderUsage` function responsible for formatting the usage data into a clean, readable block for the UI.
    *   This block displays a breakdown of prompt, completion, and total tokens, along with the calculated cost for each of the three phases. It also includes a "TOTALS" line that sums up the cost and tokens for the entire operation.
    *   I updated the main view rendering logic to display this usage block as a new message in the chat interface immediately after a heavy mode synthesis is successfully completed.

## 2. Trade-offs Made

*   **Manual Go SDK Update:** The most significant trade-off was manually editing the generated Go SDK. I was unable to get the development server to run, which is a prerequisite for the automatic SDK generation script. While the manual edit is precise and tailored to this feature, it is a brittle solution. Any future changes to the backend API or event schemas will require another careful, manual update. The correct, long-term solution is to fix the development environment to allow for seamless, automatic SDK generation.

*   **Lack of New Tests:** Due to the same environmental issues that blocked SDK generation, I was unable to run the project's test suite or build the application. Consequently, I could not add new unit or integration tests to validate the new functionality. The verification of these changes relies on static code correctness, which is not as robust as a full testing cycle.

## 3. What Should Be Done Next

1.  **Fix the Development Environment:** The highest priority next step is to diagnose and resolve the issues preventing the development server and Go test suite from running. A stable and functional local environment is critical for maintaining code quality and developer velocity.

2.  **Regenerate the Go SDK:** Once the development environment is fixed, the Go SDK should be properly regenerated using the Stainless tooling. The manual edits I made to `packages/sdk/go/event.go` should be reverted, and the file should be replaced with the auto-generated version to ensure it is perfectly in sync with the API.

3.  **Implement Comprehensive Testing:** With a working test environment, a suite of tests should be added to cover the new functionality. This should include:
    *   **Backend unit tests** to verify the accuracy of the usage aggregation and cost calculations in `heavy.ts`.
    *   **TUI tests** to confirm that the `heavy.synthesis.completed` event is parsed correctly and that the `renderUsage` function displays the information as expected.

4.  **Refine Cost Formatting:** The cost is currently displayed with a fixed precision of 6 decimal places (e.g., `$0.001234`). A potential UX improvement would be to implement dynamic formatting to show more precision for very low costs and fewer decimal places for higher costs, enhancing readability for the user.
