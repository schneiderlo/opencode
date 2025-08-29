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


