package qualityguard

import (
	"context"
	"errors"
	"fmt"

	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

// probeSampleDeleteLimit caps one batch delete call.
const probeSampleDeleteLimit = 500

// Service serves the quality-guard probe sample gallery: stored probe
// attempts with their parsed response/reasoning text and automatic verdict.
type Service struct {
	samples repository.ProbeSampleRepository
}

func NewService(samples repository.ProbeSampleRepository) *Service {
	return &Service{samples: samples}
}

func (s *Service) ListProbeSamples(ctx context.Context, filter audit.ProbeSampleFilter) ([]audit.ProbeSample, int64, error) {
	if s.samples == nil {
		return nil, 0, ErrUnavailable
	}
	if filter.Page < 1 {
		filter.Page = 1
	}
	if filter.PageSize < 1 {
		filter.PageSize = 20
	}
	return s.samples.List(ctx, filter)
}

func (s *Service) GetProbeSample(ctx context.Context, id uint64) (audit.ProbeSample, error) {
	if s.samples == nil {
		return audit.ProbeSample{}, ErrUnavailable
	}
	if id == 0 {
		return audit.ProbeSample{}, fmt.Errorf("%w: sample id 必填", ErrInvalidInput)
	}
	return s.samples.Get(ctx, id)
}

// MarkProbeSample rewrites the operator annotation; it never affects the
// strike machine.
func (s *Service) MarkProbeSample(ctx context.Context, id uint64, flag string) (audit.ProbeSample, error) {
	if s.samples == nil {
		return audit.ProbeSample{}, ErrUnavailable
	}
	if id == 0 {
		return audit.ProbeSample{}, fmt.Errorf("%w: sample id 必填", ErrInvalidInput)
	}
	switch flag {
	case audit.ProbeSampleManualNone, audit.ProbeSampleManualSuspected, audit.ProbeSampleManualNormal:
	default:
		return audit.ProbeSample{}, fmt.Errorf("%w: manual flag 仅支持 suspected / normal / 空值", ErrInvalidInput)
	}
	value, err := s.samples.UpdateManualFlag(ctx, id, flag)
	if errors.Is(err, repository.ErrNotFound) {
		return audit.ProbeSample{}, ErrSampleMissing
	}
	return value, err
}

// MarkProbeSamples rewrites the operator annotation on a batch; it never
// affects the strike machine.
func (s *Service) MarkProbeSamples(ctx context.Context, ids []uint64, flag string) (int64, error) {
	if s.samples == nil {
		return 0, ErrUnavailable
	}
	if len(ids) == 0 {
		return 0, fmt.Errorf("%w: ids 必填", ErrInvalidInput)
	}
	if len(ids) > probeSampleDeleteLimit {
		return 0, fmt.Errorf("%w: 单次最多标记 %d 条", ErrInvalidInput, probeSampleDeleteLimit)
	}
	switch flag {
	case audit.ProbeSampleManualNone, audit.ProbeSampleManualSuspected, audit.ProbeSampleManualNormal:
	default:
		return 0, fmt.Errorf("%w: manual flag 仅支持 suspected / normal / 空值", ErrInvalidInput)
	}
	return s.samples.UpdateManualFlagMany(ctx, ids, flag)
}

func (s *Service) DeleteProbeSample(ctx context.Context, id uint64) (int64, error) {
	if s.samples == nil {
		return 0, ErrUnavailable
	}
	if id == 0 {
		return 0, fmt.Errorf("%w: sample id 必填", ErrInvalidInput)
	}
	deleted, err := s.samples.Delete(ctx, id)
	if err != nil {
		return 0, err
	}
	if deleted == 0 {
		return 0, ErrSampleMissing
	}
	return deleted, nil
}

// DeleteProbeSamples hard-deletes up to probeSampleDeleteLimit samples in one
// call; evidence rows only, so no strike-machine side effects.
func (s *Service) DeleteProbeSamples(ctx context.Context, ids []uint64) (int64, error) {
	if s.samples == nil {
		return 0, ErrUnavailable
	}
	if len(ids) == 0 {
		return 0, fmt.Errorf("%w: ids 必填", ErrInvalidInput)
	}
	if len(ids) > probeSampleDeleteLimit {
		return 0, fmt.Errorf("%w: 单次最多删除 %d 条", ErrInvalidInput, probeSampleDeleteLimit)
	}
	return s.samples.DeleteMany(ctx, ids)
}
