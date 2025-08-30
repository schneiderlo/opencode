// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

package opencode

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/sst/opencode-sdk-go/internal/apijson"
	"github.com/sst/opencode-sdk-go/internal/param"
	"github.com/sst/opencode-sdk-go/internal/requestconfig"
	"github.com/sst/opencode-sdk-go/option"
)

// SessionHeavyService contains methods for interacting with heavy-mode session operations.
//
// Note, unlike clients, this service does not read variables from the environment
// automatically. You should not instantiate this service directly, and instead use
// the [NewSessionHeavyService] method instead.
type SessionHeavyService struct {
	Options []option.RequestOption
}

// NewSessionHeavyService generates a new service that applies the given options to each
// request. These options are applied after the parent client's options (if there is one),
// and before any request-specific options.
func NewSessionHeavyService(opts ...option.RequestOption) (r *SessionHeavyService) {
	r = &SessionHeavyService{}
	r.Options = opts
	return
}

// Respond to a heavy mode plan (approve/reject)
func (r *SessionHeavyService) RespondPlan(ctx context.Context, id string, body SessionHeavyRespondPlanParams, opts ...option.RequestOption) (res *bool, err error) {
	opts = append(r.Options[:], opts...)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/heavy/respond-plan", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, body, &res, opts...)
	return
}

type SessionHeavyRespondPlanParams struct {
	Approved param.Field[bool] `json:"approved,required"`
}

func (r SessionHeavyRespondPlanParams) MarshalJSON() (data []byte, err error) {
	return apijson.MarshalRoot(r)
}

// --- Types and Zod Schemas ---
type PlannerSubTask struct {
	ID          int    `json:"id"`
	Question    string `json:"question"`
	Deliverable string `json:"deliverable"`
}

type PlannerOutput struct {
	OriginalQuery string           `json:"original_query"`
	SubTasks      []PlannerSubTask `json:"sub_tasks"`
}

type ExecutorTaskResult struct {
	TaskID         int    `json:"taskId"`
	ChildSessionID string `json:"childSessionID"`
	ProviderID     string `json:"providerID"`
	ModelID        string `json:"modelID"`
	Status         string `json:"status"` // "completed" | "failed"
	Report         string `json:"report,omitempty"`
	Error          string `json:"error,omitempty"`
}

type RunHeavyWorkflowParams struct {
	ModelID    param.Field[string]                       `json:"modelID,required"`
	Parts      param.Field[[]SessionChatParamsPartUnion] `json:"parts,required"`
	ProviderID param.Field[string]                       `json:"providerID,required"`
	Agent      param.Field[string]                       `json:"agent"`
	MessageID  param.Field[string]                       `json:"messageID"`
	System     param.Field[string]                       `json:"system"`
	Tools      param.Field[map[string]bool]              `json:"tools"`
}

func (r *SessionHeavyService) RunHeavyWorkflow(ctx context.Context, id string, body RunHeavyWorkflowParams, opts ...option.RequestOption) (res *SessionChatResponse, err error) {
	opts = append(r.Options[:], opts...)
	if id == "" {
		err = errors.New("missing required id parameter")
		return
	}
	path := fmt.Sprintf("session/%s/message", id)
	err = requestconfig.ExecuteNewRequest(ctx, http.MethodPost, path, SessionChatParams{
		ModelID:    body.ModelID,
		Parts:      body.Parts,
		ProviderID: body.ProviderID,
		Agent:      body.Agent,
		MessageID:  body.MessageID,
		System:     body.System,
		Tools:      body.Tools,
		Mode:       F("heavy"),
	}, &res, opts...)
	return
}
