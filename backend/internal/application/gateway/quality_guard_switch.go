package gateway

import (
	"encoding/json"
	"os"
	"sync"
	"time"
)

const qualityGuardSwitchCacheTTL = 5 * time.Second

// qualityGuardRuntimeSwitch mirrors the operator-managed global quality guard
// switch persisted in the guard runtime config file (settings.enabled). Reads
// are cached briefly so request-path checks never hit the disk every time; a
// missing or unreadable file defaults to enabled.
type qualityGuardRuntimeSwitch struct {
	path    string
	mu      sync.Mutex
	enabled bool
	expires time.Time
}

func (s *qualityGuardRuntimeSwitch) Enabled() bool {
	if s == nil || s.path == "" {
		return true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if now.Before(s.expires) {
		return s.enabled
	}
	enabled := true
	if data, err := os.ReadFile(s.path); err == nil {
		var payload struct {
			Settings struct {
				Enabled *bool `json:"enabled"`
			} `json:"settings"`
		}
		if json.Unmarshal(data, &payload) == nil && payload.Settings.Enabled != nil {
			enabled = *payload.Settings.Enabled
		}
	}
	s.enabled = enabled
	s.expires = now.Add(qualityGuardSwitchCacheTTL)
	return enabled
}

// SetQualityGuardRuntimeSwitch points the guard switch at the runtime config
// file; an empty path disables the switch (guard always considered enabled).
func (s *Service) SetQualityGuardRuntimeSwitch(path string) {
	if path == "" {
		s.qualityGuardSwitch.Store(nil)
		return
	}
	s.qualityGuardSwitch.Store(&qualityGuardRuntimeSwitch{path: path})
}

func (s *Service) qualityGuardRuntimeEnabled() bool {
	return s.qualityGuardSwitch.Load().Enabled()
}
