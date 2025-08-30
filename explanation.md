# Explanation of the Go SDK for Heavy Mode

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
