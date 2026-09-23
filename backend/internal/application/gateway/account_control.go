package gateway

import (
	"context"
	"errors"
	"fmt"
	"time"

	egressapp "github.com/chenyme/grok2api/backend/internal/application/egress"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// maxAccountCoolingDuration caps operator-ordered cooldowns at one week.
const maxAccountCoolingDuration = 7 * 24 * time.Hour

// QuarantineAccount removes one Build account from rotation for the chosen
// duration without touching its failure counts or strike history.
func (s *Service) QuarantineAccount(ctx context.Context, accountID uint64, cooldown time.Duration) error {
	if accountID == 0 {
		return fmt.Errorf("%w: accountId 必填", egressapp.ErrInvalidInput)
	}
	if cooldown < time.Hour || cooldown > maxAccountCoolingDuration {
		return fmt.Errorf("%w: 隔离时长必须在 1 小时到 7 天之间", egressapp.ErrInvalidInput)
	}
	return s.selector.MarkAccountCooling(ctx, accountdomain.ProviderBuild, accountID, cooldown)
}

// QuarantineAccounts removes many Build accounts from rotation with the same
// cooldown, reporting missing IDs instead of failing the whole batch.
func (s *Service) QuarantineAccounts(ctx context.Context, accountIDs []uint64, cooldown time.Duration) ([]uint64, []uint64, error) {
	if len(accountIDs) == 0 {
		return nil, nil, fmt.Errorf("%w: accountIds 必填", egressapp.ErrInvalidInput)
	}
	if cooldown < time.Hour || cooldown > maxAccountCoolingDuration {
		return nil, nil, fmt.Errorf("%w: 隔离时长必须在 1 小时到 7 天之间", egressapp.ErrInvalidInput)
	}
	quarantined := make([]uint64, 0, len(accountIDs))
	missing := make([]uint64, 0)
	for _, accountID := range accountIDs {
		if accountID == 0 {
			continue
		}
		if err := s.selector.MarkAccountCooling(ctx, accountdomain.ProviderBuild, accountID, cooldown); err != nil {
			if errors.Is(err, repository.ErrNotFound) {
				missing = append(missing, accountID)
				continue
			}
			return nil, nil, err
		}
		quarantined = append(quarantined, accountID)
	}
	return quarantined, missing, nil
}

// RestoreAccount re-enables one Build account and clears its cooldown,
// missing-thinking strike marker, and failure backoff.
func (s *Service) RestoreAccount(ctx context.Context, accountID uint64) error {
	if accountID == 0 {
		return fmt.Errorf("%w: accountId 必填", egressapp.ErrInvalidInput)
	}
	return s.selector.RestoreAccount(ctx, accountdomain.ProviderBuild, accountID)
}
