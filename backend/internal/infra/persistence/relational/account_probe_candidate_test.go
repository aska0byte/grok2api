package relational

import (
	"context"
	"testing"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
)

// Pinned operator probes must reach accounts the ordinary scheduler filters
// out at the SQL layer (disabled, reauth-required); otherwise cooled accounts
// can never be re-verified before a permanent disable decision.
func TestListRoutingCandidateForProbeIgnoresSchedulingFilters(t *testing.T) {
	ctx := context.Background()
	database := openTestDatabase(t)
	repository := NewAccountRepository(database)

	disabled := createEgressOperationsAccount(t, ctx, repository, "probe-disabled-account")
	flagged := createEgressOperationsAccount(t, ctx, repository, "probe-reauth-account")
	if err := database.db.WithContext(ctx).Model(&accountModel{}).Where("id = ?", disabled.ID).Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.db.WithContext(ctx).Model(&accountModel{}).Where("id = ?", flagged.ID).Updates(map[string]any{
		"auth_status":      string(account.AuthStatusReauthRequired),
		"reauth_marked_at": time.Now().UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}

	candidate, ok, err := repository.ListRoutingCandidateForProbe(ctx, account.ProviderBuild, disabled.ID)
	if err != nil || !ok {
		t.Fatalf("disabled account: ok=%v err=%v", ok, err)
	}
	if candidate.Credential.ID != disabled.ID || candidate.Credential.Enabled {
		t.Fatalf("disabled candidate = %#v", candidate.Credential)
	}
	if !candidate.SupportsModel || !candidate.ModelCapabilityKnown {
		t.Fatalf("probe candidate must bypass capability gating: %#v", candidate)
	}

	candidate, ok, err = repository.ListRoutingCandidateForProbe(ctx, account.ProviderBuild, flagged.ID)
	if err != nil || !ok {
		t.Fatalf("reauth account: ok=%v err=%v", ok, err)
	}
	if candidate.Credential.AuthStatus != account.AuthStatusReauthRequired {
		t.Fatalf("reauth candidate auth = %q", candidate.Credential.AuthStatus)
	}

	if _, ok, err := repository.ListRoutingCandidateForProbe(ctx, account.ProviderBuild, 4294967295); err != nil || ok {
		t.Fatalf("missing account: ok=%v err=%v", ok, err)
	}
}
