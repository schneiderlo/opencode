// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

package opencode

import (
	"context"
	"testing"

	"bytes"
	"io"
	"net/http"

	"github.com/sst/opencode-sdk-go/option"
)

type mockTransport struct {
	fn func(req *http.Request) (*http.Response, error)
}

func (t *mockTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return t.fn(req)
}

func TestSessionHeavyRespondPlan(t *testing.T) {
	client := NewClient(
		option.WithHTTPClient(&http.Client{
			Transport: &mockTransport{
				fn: func(req *http.Request) (*http.Response, error) {
					return &http.Response{
						StatusCode: http.StatusOK,
						Header:     http.Header{"Content-Type": []string{"application/json"}},
						Body:       io.NopCloser(bytes.NewBufferString(`true`)),
					}, nil
				},
			},
		}),
	)
	_, err := client.Session.Heavy.RespondPlan(
		context.TODO(),
		"session_123",
		SessionHeavyRespondPlanParams{
			Approved: F(true),
		},
	)
	if err != nil {
		t.Fatalf("err should be nil: %s", err.Error())
	}
}

func TestSessionHeavyRunHeavyWorkflow(t *testing.T) {
	client := NewClient(
		option.WithHTTPClient(&http.Client{
			Transport: &mockTransport{
				fn: func(req *http.Request) (*http.Response, error) {
					return &http.Response{
						StatusCode: http.StatusOK,
						Header:     http.Header{"Content-Type": []string{"application/json"}},
						Body:       io.NopCloser(bytes.NewBufferString(`{"info": {"id": "message_123", "role": "assistant", "sessionID": "session_123", "time": {"created": 123}, "cost": 0, "mode": "heavy", "modelID": "model_123", "providerID": "provider_123", "path": {"cwd": "/", "root": "/"}, "system": [], "tokens": {"cache": {"read": 0, "write": 0}, "input": 0, "output": 0, "reasoning": 0}}, "parts": []}`)),
					}, nil
				},
			},
		}),
	)
	_, err := client.Session.Heavy.RunHeavyWorkflow(
		context.TODO(),
		"session_123",
		RunHeavyWorkflowParams{
			ModelID:    F("model_123"),
			ProviderID: F("provider_123"),
			Parts: F([]SessionChatParamsPartUnion{
				TextPartInputParam{
					Text: F("hello"),
					Type: F(TextPartInputTypeText),
				},
			}),
		},
	)
	if err != nil {
		t.Fatalf("err should be nil: %s", err.Error())
	}
}
