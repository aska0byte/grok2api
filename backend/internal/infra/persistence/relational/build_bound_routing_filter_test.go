package relational

import (
	"context"
	"testing"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	egressdomain "github.com/chenyme/grok2api/backend/internal/domain/egress"
)

// 使用受限语义：一旦部署中存在可用 production 节点，未绑定长效节点的 Build
// 账号不得参与普通推理路由；没有任何可用 production 节点时不过滤（传统直连）。
func TestListRoutingCandidatesFiltersUnboundBuildWhenProductionNodesExist(t *testing.T) {
	ctx := context.Background()
	database := openTestDatabase(t)
	accounts := NewAccountRepository(database)
	egress := NewEgressRepository(database)

	unbound, _, err := accounts.UpsertByIdentity(ctx, account.Credential{
		Provider: account.ProviderBuild, Name: "unbound", SourceKey: "unbound",
		EncryptedAccessToken: testEncryptedToken, Enabled: true, AuthStatus: account.AuthStatusActive,
	})
	if err != nil {
		t.Fatal(err)
	}
	boundTarget, err := egress.CreateEgressNode(ctx, egressdomain.Node{
		Name: "production", Scope: egressdomain.ScopeBuild, Enabled: true, EncryptedProxyURL: "encrypted",
	})
	if err != nil {
		t.Fatal(err)
	}
	bound, _, err := accounts.UpsertByIdentity(ctx, account.Credential{
		Provider: account.ProviderBuild, Name: "bound", SourceKey: "bound",
		EncryptedAccessToken: testEncryptedToken, Enabled: true, AuthStatus: account.AuthStatusActive,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := accounts.UpdateEgressBindings(ctx, account.ProviderBuild, []uint64{bound.ID}, &boundTarget.ID, account.EgressAssignmentManual, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}

	candidates, err := accounts.ListRoutingCandidates(ctx, account.ProviderBuild, 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	seen := make(map[uint64]bool, len(candidates))
	for _, candidate := range candidates {
		seen[candidate.Credential.ID] = true
	}
	if seen[unbound.ID] {
		t.Fatalf("unbound build account must not serve traffic when production nodes exist")
	}
	if !seen[bound.ID] {
		t.Fatalf("bound build account missing from candidates")
	}

	// 没有任何可用 production 节点（禁用后）→ 过滤关闭，直连兜底语义生效。
	if _, err := egress.UpdateEgressNode(ctx, egressdomain.Node{
		ID: boundTarget.ID, Name: "production", Scope: egressdomain.ScopeBuild, Enabled: false, EncryptedProxyURL: "encrypted",
	}); err != nil {
		t.Fatal(err)
	}
	candidates, err = accounts.ListRoutingCandidates(ctx, account.ProviderBuild, 0, "", "")
	if err != nil {
		t.Fatal(err)
	}
	seen = make(map[uint64]bool, len(candidates))
	for _, candidate := range candidates {
		seen[candidate.Credential.ID] = true
	}
	if !seen[unbound.ID] || !seen[bound.ID] {
		t.Fatalf("filter must disarm with no usable production nodes: unbound=%v bound=%v", seen[unbound.ID], seen[bound.ID])
	}
}
