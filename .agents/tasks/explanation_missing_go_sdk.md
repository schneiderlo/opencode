# Explanation of the Go SDK for Heavy Mode

Commit 5252b6d4e77084b5f1b241a802d6cddc55b1b819

This document provides an explanation of the work done to complete the Go SDK for heavy mode.

## What was done

The initial state of the Go SDK for heavy mode was incomplete. It consisted of a single `sessionheavy.go` file with a `RespondPlan` function, but it was missing tests, examples, and documentation. The goal of this task was to complete the SDK.

The following steps were taken to complete the task:

1.  **API Discovery:** Since there was no formal API specification for the heavy mode, the first step was to reverse-engineer the API from the existing typescript implementation. The `packages/opencode/src/session/heavy.ts` and `packages/opencode/src/server/server.ts` files were analyzed to understand the API. It was discovered that the heavy mode is triggered by a `mode: "heavy"` parameter in the `chat` endpoint, not by a separate set of endpoints for the planner, executor, and synthesizer.

2.  **Go SDK Implementation:**
    *   The `sessionheavy.go` file was renamed to `heavy.go` to better reflect its purpose.
    *   The necessary data structures were added to `heavy.go` to represent the planner output and executor task results.
    *   The `RunHeavyWorkflow` function was implemented in `heavy.go` to call the `chat` endpoint with the `mode: "heavy"` parameter.
    *   The `SessionChatParams` struct in `session.go` was updated to include a `Mode` field.

3.  **Testing:**
    *   A `heavy_test.go` file was created to house the tests for the heavy mode functionality.
    *   Tests were added for both the `RespondPlan` and `RunHeavyWorkflow` functions.
    *   The HTTP client was mocked in the tests to allow for testing without a live server.

4.  **Example:** An example file was created at `packages/sdk/go/examples/heavy/main.go` to demonstrate how to use the new functionality.

5.  **Documentation:** The `api.md` file was updated to document the new `SessionHeavyService` and its methods.

## Trade-offs

*   **API Discovery:** The lack of a formal API specification was the biggest challenge. The API had to be inferred from the typescript implementation, which is not ideal. This could lead to inconsistencies if the typescript implementation changes in the future.
*   **Testing:** The tests were written using a mocked HTTP client. While this is a standard practice, it means that the tests are not testing the full end-to-end functionality.

## What should be done next

*   **Formal API Specification:** The most important next step is to create a formal OpenAPI specification for the heavy mode API. This will ensure that the Go SDK and any other future SDKs are consistent with the server implementation.
*   **Integration Tests:** Add integration tests that run against a real test server. This will provide more confidence in the correctness of the SDK.
*   **Flesh out the `RunHeavyWorkflow` function:** The current implementation of `RunHeavyWorkflow` is a simple wrapper around the `chat` endpoint. It could be extended to provide more features, such as:
    *   Streaming the results of the workflow.
    *   Providing progress updates.
    *   Handling user input during the workflow (e.g., for approvals).
*   **Error Handling:** The error handling in the SDK is currently very basic. It could be improved to provide more detailed error messages and to handle different types of errors more gracefully.



## Analysis - Comparison between 5252b6d4 and a95816a0

Excellent question. This is a substantial feature, and it's wise to get a second pair of eyes on it. I've reviewed both the initial feature patch and the follow-up commit for the Go SDK.

Here is a detailed breakdown of my analysis.

### Executive Summary

**Yes, the second commit for the Go SDK looks correct and is a significant improvement over the initial implementation.** It correctly identifies how the heavy mode is triggered and adds the necessary components (tests, examples, documentation) for a complete SDK feature.

The overall feature implementation in the first patch is very impressive and comprehensive. It's a well-thought-out, full-stack feature. I have a few minor suggestions and observations for potential improvements, but the core logic and architecture are solid.

---

### Analysis of the Second Commit (Go SDK Fix)

This commit was your specific point of concern, so let's start here. You were told the Go SDK was missing, and this patch addresses that perfectly.

#### What Looks Correct (The Good):

1.  **Correct API Usage:** The `explanation.md` file is fantastic and shows a deep understanding of the problem. You correctly identified that heavy mode is not a new set of endpoints but rather a `mode: "heavy"` parameter on the existing chat endpoint. This is a critical insight.
2.  **Structural Improvement:** Deleting the old `sessionheavy.go` and creating a new, more focused `heavy.go` is the right move. The new `SessionHeavyService` provides a clean, dedicated interface for heavy mode operations.
3.  **Completeness:** This is what a "complete" SDK feature looks like. You've included:
    *   **The core logic** (`heavy.go`): With a clear `RunHeavyWorkflow` function.
    *   **Unit Tests** (`heavy_test.go`): Essential for maintainability. Mocking the transport is a standard and effective way to test the SDK client.
    *   **An Example** (`examples/heavy/main.go`): Crucial for user adoption and understanding.
    *   **Documentation** (`api.md` update): Ensures the public-facing documentation is in sync with the code.
4.  **Implementation Details:** The `RunHeavyWorkflow` function correctly wraps the main `session.Chat` call, adding the `Mode: F("heavy")` parameter. This is clean and reuses existing logic.

#### What Might Be Missing or "Something Else":

There isn't much "missing" in the sense of being broken, but here are a couple of observations and potential next steps:

1.  **Server-Side Endpoint Inconsistency:** Your second commit adds a new server endpoint: `/session/:id/heavy/run`. However, the Go SDK's `RunHeavyWorkflow` function **does not use this new endpoint**. It correctly calls the main `/session/:id/message` endpoint (the chat endpoint).
    *   **Is this a problem?** Not necessarily. The new `/heavy/run` endpoint might be intended as a simpler fire-and-forget trigger for other clients. But it creates a slight inconsistency where the Go SDK function with the same name (`RunHeavyWorkflow`) uses a different underlying API call. This is a minor point but worth being aware of.
2.  **Event Handling:** The current Go SDK initiates the workflow but doesn't provide helpers for tracking its progress. A user of the Go SDK would have to separately subscribe to the event stream and parse the `heavy.plan.generated`, `heavy.task.started`, etc., events themselves.
    *   **Next Step Suggestion:** A future enhancement could be a more sophisticated `RunHeavyWorkflow` function that takes callbacks or returns a channel for progress events, making the SDK even more powerful and user-friendly. Your `explanation.md` correctly identifies this as a potential next step.

**Conclusion for the Go SDK patch:** It's a great commit. It's correct, complete, and demonstrates a solid understanding of both the feature and good SDK design principles.

---

### Analysis of the First Commit (Overall Feature)

Looking at the initial, larger patch gives the full context. It's an excellent piece of work.

#### Strengths:

1.  **Comprehensive Scope:** This is a true full-stack feature. You've touched the backend config, server logic, session management, TUI, both SDKs, and documentation. This is the right way to ship a major feature.
2.  **Excellent TUI Experience:** The implementation of the plan approval prompt and the live dashboard in the TUI is a fantastic UX feature. For a potentially long-running and expensive operation, giving the user visibility and control is critical.
3.  **Configurability:** The `heavy` section in `opencode.json` is well-designed. It provides users with meaningful control over models, concurrency, tool access, and retry logic. This makes the feature flexible and adaptable.
4.  **Event-Driven Architecture:** Using a `Bus` to publish events like `Heavy.PlanGenerated` and `Heavy.TaskCompleted` is the correct architecture. It decouples the core workflow from the UI (or any other listener), which is great for maintainability.

#### Minor Suggestions ("Something Else"):

1.  **JS SDK Type Safety:** In `packages/sdk/js/src/gen/types.gen.ts`, the `HeavyPlanPart` has `plan: z.any()`. It would be more robust to define the Zod schema for the planner's output and use it here. This would provide full type safety to JS/TS users of the SDK.
2.  **TUI State Management:** In `packages/tui/internal/app/app.go`, all the new state variables (`PendingPlan`, `HeavyTasks`, etc.) are added directly to the main `App` struct. For a complex feature like this, you might consider encapsulating them into a single sub-struct (e.g., `HeavyModeState app.HeavyModeState`) to keep the main `App` struct cleaner as the application grows. This is a minor architectural preference.
3.  **Magic Strings in TUI:** The TUI code uses strings like `"running"`, `"completed"`, `"failed"` to track task status. It's generally safer to define these as constants (e.g., `const StatusRunning = "running"`) to prevent typos and make the code easier to refactor.
4.  **`FORK_WORKFLOW.md`:** This is a very useful developer guide, but it's unrelated to the feature itself. A minor process nitpick would be to suggest putting environment/workflow changes like this into a separate commit from the feature implementation to keep the history cleaner.

### Final Verdict

You have implemented a powerful and well-architected feature. The follow-up commit to fix the Go SDK is **spot-on and correct**. It addresses the initial shortcomings perfectly.

The feature is robust, user-friendly (thanks to the TUI work), and configurable. The minor points I've raised are suggestions for refinement, not critical flaws. This is high-quality work.