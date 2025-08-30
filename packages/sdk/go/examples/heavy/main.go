package main

import (
	"context"
	"fmt"
	"os"

	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode-sdk-go/option"
)

func main() {
	baseURL := "http://localhost:4010"
	if envURL, ok := os.LookupEnv("TEST_API_BASE_URL"); ok {
		baseURL = envURL
	}
	client := opencode.NewClient(
		option.WithBaseURL(baseURL),
		option.WithHeader("Authorization", "Bearer My API Key"),
	)

	// 1. Run the heavy workflow
	workflow, err := client.Session.Heavy.RunHeavyWorkflow(
		context.TODO(),
		"session_123",
		opencode.RunHeavyWorkflowParams{
			ModelID:    opencode.F("model_123"),
			ProviderID: opencode.F("provider_123"),
			Parts: opencode.F([]opencode.SessionChatParamsPartUnion{
				opencode.TextPartInputParam{
					Text: opencode.F("hello"),
					Type: opencode.F(opencode.TextPartInputTypeText),
				},
			}),
		},
	)
	if err != nil {
		panic(err.Error())
	}
	fmt.Printf("Workflow started: %+v\n", workflow)

	// 2. Respond to the plan
	_, err = client.Session.Heavy.RespondPlan(
		context.TODO(),
		"session_123",
		opencode.SessionHeavyRespondPlanParams{
			Approved: opencode.F(true),
		},
	)
	if err != nil {
		panic(err.Error())
	}
	fmt.Println("Plan approved")
}
