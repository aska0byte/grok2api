package relational

import (
	"context"
	"testing"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
)

// Regression: the lookup used to Pluck into **uint64, which hits gorm's
// default scan branch ("sql: Scan called without calling Next") and broke
// every quality probe at the binding-resolution stage.
func TestGetAccountEgressNodeIDResolvesBindings(t *testing.T) {
	ctx := context.Background()
	database := openTestDatabase(t)
	accounts := NewAccountRepository(database)
	nodes := NewEgressRepository(database)
	cipher := egressOperationsCipher(t)
	node := createHealthyEgressNode(t, ctx, nodes, cipher, "probe-bound", 1)
	bound := createEgressOperationsAccount(t, ctx, accounts, "probe-bound-account")
	unbound := createEgressOperationsAccount(t, ctx, accounts, "probe-unbound-account")
	old := time.Now().UTC().Add(-time.Minute)
	if _, err := accounts.UpdateEgressBindings(ctx, account.ProviderBuild, []uint64{bound.ID}, &node.ID, account.EgressAssignmentAuto, old); err != nil {
		t.Fatal(err)
	}

	got, err := accounts.GetAccountEgressNodeID(ctx, bound.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got != node.ID {
		t.Fatalf("bound account node = %d, want %d", got, node.ID)
	}

	got, err = accounts.GetAccountEgressNodeID(ctx, unbound.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got != 0 {
		t.Fatalf("unbound account node = %d, want 0", got)
	}

	got, err = accounts.GetAccountEgressNodeID(ctx, 4294967295)
	if err != nil {
		t.Fatal(err)
	}
	if got != 0 {
		t.Fatalf("missing account node = %d, want 0", got)
	}

	got, err = accounts.GetAccountEgressNodeID(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got != 0 {
		t.Fatalf("zero account node = %d, want 0", got)
	}
}
