package egress

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
)

// maxQualityProbeBatchConcurrency bounds the shared worker pool so operator
// initiated batch probes cannot starve normal traffic of upstream slots.
const maxQualityProbeBatchConcurrency = 4

// AccountQualityBatchItem is the per-account outcome streamed back to the
// operator while a batch probe task is running.
type AccountQualityBatchItem struct {
	AccountID       uint64
	Outcome         string
	MissingThinking bool
	Action          string
	Overturned      bool
	Reason          string
}

// RunAccountQualityProbeBatch probes many accounts through the exact single
// account probe path (pinning, strike machine, samples, cooldowns) with a
// bounded worker pool. Cancelling ctx stops new dispatches; in-flight probes
// abort through their request context and count as failed.
func (s *Service) RunAccountQualityProbeBatch(ctx context.Context, accountIDs []uint64, kind string, concurrency int, progress func(completed, total int), item func(AccountQualityBatchItem)) (int, int, error) {
	if len(accountIDs) == 0 {
		return 0, 0, fmt.Errorf("%w: accountIds 必填", ErrInvalidInput)
	}
	if concurrency < 1 {
		concurrency = 3
	}
	if concurrency > maxQualityProbeBatchConcurrency {
		concurrency = maxQualityProbeBatchConcurrency
	}
	total := len(accountIDs)
	var done, succeeded, failed atomic.Int64
	var wg sync.WaitGroup
	sem := make(chan struct{}, concurrency)
	for _, accountID := range accountIDs {
		if ctx.Err() != nil {
			break
		}
		select {
		case sem <- struct{}{}:
		case <-ctx.Done():
		}
		if ctx.Err() != nil {
			break
		}
		wg.Add(1)
		go func(accountID uint64) {
			defer wg.Done()
			defer func() {
				<-sem
				completed := done.Add(1)
				if progress != nil {
					progress(int(completed), total)
				}
			}()
			result, probeErr := s.ProbeAccountQuality(ctx, accountID, 0, QualityProbeInput{Kind: kind})
			entry := AccountQualityBatchItem{AccountID: accountID}
			if probeErr != nil {
				failed.Add(1)
				entry.Outcome = "failed"
				entry.Reason = probeErr.Error()
			} else {
				succeeded.Add(1)
				entry.Outcome = "ok"
				entry.MissingThinking = result.MissingThinking
				entry.Action = result.Action
				entry.Overturned = result.Overturned
			}
			if item != nil {
				item(entry)
			}
		}(accountID)
	}
	wg.Wait()
	if err := ctx.Err(); err != nil {
		return int(succeeded.Load()), int(failed.Load()), err
	}
	return int(succeeded.Load()), int(failed.Load()), nil
}
