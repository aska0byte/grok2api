package repository

import (
	"context"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/audit"
)

// ProbeSampleRepository persists quality-guard account probe samples for the
// sample gallery: one row per probe attempt with the parsed response and
// reasoning text plus the automatic verdict.
type ProbeSampleRepository interface {
	Create(ctx context.Context, value audit.ProbeSample) (audit.ProbeSample, error)
	Get(ctx context.Context, id uint64) (audit.ProbeSample, error)
	List(ctx context.Context, filter audit.ProbeSampleFilter) ([]audit.ProbeSample, int64, error)
	UpdateManualFlag(ctx context.Context, id uint64, flag string) (audit.ProbeSample, error)
	UpdateManualFlagMany(ctx context.Context, ids []uint64, flag string) (int64, error)
	Delete(ctx context.Context, id uint64) (int64, error)
	DeleteMany(ctx context.Context, ids []uint64) (int64, error)
	DeleteCreatedBefore(ctx context.Context, cutoff time.Time) (int64, error)
}
