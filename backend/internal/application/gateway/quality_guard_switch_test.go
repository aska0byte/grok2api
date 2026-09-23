package gateway

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestQualityGuardRuntimeSwitchDefaultsToEnabled(t *testing.T) {
	service := &Service{}
	if !service.qualityGuardRuntimeEnabled() {
		t.Fatal("switch without a path should report enabled")
	}
}

func TestQualityGuardRuntimeSwitchFollowsRuntimeConfigFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "runtime-config.json")
	if err := os.WriteFile(path, []byte(`{"version":1,"settings":{"enabled":false}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	service := &Service{}
	service.SetQualityGuardRuntimeSwitch(path)
	if service.qualityGuardRuntimeEnabled() {
		t.Fatal("switch should be disabled per runtime config")
	}

	if err := os.WriteFile(path, []byte(`{"version":1,"settings":{"enabled":true}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	switcher := service.qualityGuardSwitch.Load()
	switcher.expires = time.Now().Add(-time.Second)
	if !service.qualityGuardRuntimeEnabled() {
		t.Fatal("switch should follow the updated runtime config")
	}

	if err := os.WriteFile(path, []byte(`{"version":1,"settings":{"mode":"hybrid","active_interval_seconds":3600,"passive_poll_seconds":10,"soft_tps":400,"hard_tps":900,"consecutive_soft":3,"consecutive_errors":4,"quarantine_seconds":600,"min_healthy_nodes":2}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	switcher.expires = time.Now().Add(-time.Second)
	if !service.qualityGuardRuntimeEnabled() {
		t.Fatal("runtime config without an enabled flag should default to enabled")
	}
}
