package relational

import (
	"context"
	"testing"

	egressdomain "github.com/chenyme/grok2api/backend/internal/domain/egress"
)

// 使用受限语义：一旦部署中存在可用 production 节点，网关普通推理路由只调度绑定
// 长效节点的 Build 账号（过滤在 gateway selector 层执行，pinned/质量探测绕过）；
// 这里验证开关数据源：存在可用 production 节点时计数为正，全部禁用后归零。
func TestCountUsableProductionEgressNodesTogglesBuildBoundRouting(t *testing.T) {
	ctx := context.Background()
	database := openTestDatabase(t)
	accounts := NewAccountRepository(database)
	egress := NewEgressRepository(database)

	usable, err := accounts.CountUsableProductionEgressNodes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if usable != 0 {
		t.Fatalf("empty deployment usable = %d, want 0", usable)
	}

	target, err := egress.CreateEgressNode(ctx, egressdomain.Node{
		Name: "production", Scope: egressdomain.ScopeBuild, Enabled: true, EncryptedProxyURL: "encrypted",
	})
	if err != nil {
		t.Fatal(err)
	}
	usable, err = accounts.CountUsableProductionEgressNodes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if usable != 1 {
		t.Fatalf("usable after create = %d, want 1", usable)
	}

	// 禁用唯一节点 → 开关关闭，直连兜底语义生效。
	if _, err := egress.UpdateEgressNode(ctx, egressdomain.Node{
		ID: target.ID, Name: "production", Scope: egressdomain.ScopeBuild, Enabled: false, EncryptedProxyURL: "encrypted",
	}); err != nil {
		t.Fatal(err)
	}
	usable, err = accounts.CountUsableProductionEgressNodes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if usable != 0 {
		t.Fatalf("usable after disable = %d, want 0", usable)
	}
}
