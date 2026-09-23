package relational

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
)

type ProbeSampleRepository struct{ db *Database }

func NewProbeSampleRepository(db *Database) *ProbeSampleRepository { return &ProbeSampleRepository{db: db} }

func toProbeSampleModel(value audit.ProbeSample) qualityProbeSampleModel {
	return qualityProbeSampleModel{
		RequestID:             value.RequestID,
		Source:                value.Source,
		Round:                 value.Round,
		Kind:                  value.Kind,
		AccountID:             value.AccountID,
		EgressNodeID:          value.EgressNodeID,
		Model:                 value.Model,
		Classification:        value.Classification,
		Action:                value.Action,
		ManualFlag:            value.ManualFlag,
		MissingThinking:       value.MissingThinking,
		ThinkingObserved:      value.ThinkingObserved,
		VisibleText:           value.VisibleText,
		VisibleTruncated:      value.VisibleTruncated,
		ReasoningText:         value.ReasoningText,
		ReasoningTruncated:    value.ReasoningTruncated,
		OutputTokens:          value.OutputTokens,
		ReasoningTokens:       value.ReasoningTokens,
		FirstTokenMS:          value.FirstTokenMS,
		DurationMS:            value.DurationMS,
		OutputTokensPerSecond: value.OutputTokensPerSecond,
		CreatedAt:             value.CreatedAt,
	}
}

func fromProbeSampleModel(row qualityProbeSampleModel) audit.ProbeSample {
	return audit.ProbeSample{
		ID:                    row.ID,
		RequestID:             row.RequestID,
		Source:                row.Source,
		Round:                 row.Round,
		Kind:                  row.Kind,
		AccountID:             row.AccountID,
		AccountName:           row.AccountName,
		EgressNodeID:          row.EgressNodeID,
		EgressNodeName:        row.EgressNodeName,
		Model:                 row.Model,
		Classification:        row.Classification,
		Action:                row.Action,
		ManualFlag:            row.ManualFlag,
		MissingThinking:       row.MissingThinking,
		ThinkingObserved:      row.ThinkingObserved,
		VisibleText:           row.VisibleText,
		VisibleTruncated:      row.VisibleTruncated,
		ReasoningText:         row.ReasoningText,
		ReasoningTruncated:    row.ReasoningTruncated,
		OutputTokens:          row.OutputTokens,
		ReasoningTokens:       row.ReasoningTokens,
		FirstTokenMS:          row.FirstTokenMS,
		DurationMS:            row.DurationMS,
		OutputTokensPerSecond: row.OutputTokensPerSecond,
		CreatedAt:             row.CreatedAt,
	}
}

// Create stores one probe sample. Account and egress node display names are
// enriched best-effort so the gallery can label rows without extra lookups.
func (r *ProbeSampleRepository) Create(ctx context.Context, value audit.ProbeSample) (audit.ProbeSample, error) {
	row := toProbeSampleModel(value)
	if strings.TrimSpace(row.AccountName) == "" && row.AccountID > 0 {
		var name string
		if err := r.db.db.WithContext(ctx).Model(&accountModel{}).
			Where("id = ?", row.AccountID).Select("name").Scan(&name).Error; err == nil {
			row.AccountName = strings.TrimSpace(name)
		}
	}
	if strings.TrimSpace(row.EgressNodeName) == "" && row.EgressNodeID > 0 {
		var name string
		if err := r.db.db.WithContext(ctx).Model(&egressNodeModel{}).
			Where("id = ?", row.EgressNodeID).Select("name").Scan(&name).Error; err == nil {
			row.EgressNodeName = strings.TrimSpace(name)
		}
	}
	if err := r.db.db.WithContext(ctx).Create(&row).Error; err != nil {
		return audit.ProbeSample{}, err
	}
	return fromProbeSampleModel(row), nil
}

func (r *ProbeSampleRepository) Get(ctx context.Context, id uint64) (audit.ProbeSample, error) {
	var row qualityProbeSampleModel
	if err := r.db.db.WithContext(ctx).Where("id = ?", id).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return audit.ProbeSample{}, repository.ErrNotFound
		}
		return audit.ProbeSample{}, mapError(err)
	}
	return fromProbeSampleModel(row), nil
}

func (r *ProbeSampleRepository) List(ctx context.Context, filter audit.ProbeSampleFilter) ([]audit.ProbeSample, int64, error) {
	query := r.db.db.WithContext(ctx).Model(&qualityProbeSampleModel{})
	if filter.AccountID > 0 {
		query = query.Where("account_id = ?", filter.AccountID)
	}
	if classification := strings.TrimSpace(filter.Classification); classification != "" {
		query = query.Where("classification = ?", classification)
	}
	if kind := strings.TrimSpace(filter.Kind); kind != "" {
		query = query.Where("kind = ?", kind)
	}
	// "none" selects unmarked rows; manual_flag = '' is the no-annotation state.
	if manualFlag := strings.TrimSpace(filter.ManualFlag); manualFlag != "" {
		if manualFlag == "none" {
			query = query.Where("manual_flag = ''")
		} else {
			query = query.Where("manual_flag = ?", manualFlag)
		}
	}
	if token := strings.TrimSpace(filter.Search); token != "" {
		like := "%" + strings.ToLower(token) + "%"
		query = query.Where("(LOWER(account_name) LIKE ? OR LOWER(request_id) LIKE ? OR LOWER(model) LIKE ?)", like, like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	rows := make([]qualityProbeSampleModel, 0, pageSize)
	if err := query.
		Order("created_at DESC, id DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	samples := make([]audit.ProbeSample, 0, len(rows))
	for _, row := range rows {
		samples = append(samples, fromProbeSampleModel(row))
	}
	return samples, total, nil
}

func (r *ProbeSampleRepository) DeleteCreatedBefore(ctx context.Context, cutoff time.Time) (int64, error) {
	result := r.db.db.WithContext(ctx).Where("created_at < ?", cutoff).Delete(&qualityProbeSampleModel{})
	return result.RowsAffected, result.Error
}

// UpdateManualFlag rewrites the operator annotation; purely cosmetic evidence
// bookkeeping that never touches the strike machine.
func (r *ProbeSampleRepository) UpdateManualFlag(ctx context.Context, id uint64, flag string) (audit.ProbeSample, error) {
	result := r.db.db.WithContext(ctx).Model(&qualityProbeSampleModel{}).
		Where("id = ?", id).Update("manual_flag", flag)
	if result.Error != nil {
		return audit.ProbeSample{}, mapError(result.Error)
	}
	if result.RowsAffected == 0 {
		return audit.ProbeSample{}, repository.ErrNotFound
	}
	return r.Get(ctx, id)
}

func (r *ProbeSampleRepository) Delete(ctx context.Context, id uint64) (int64, error) {
	result := r.db.db.WithContext(ctx).Where("id = ?", id).Delete(&qualityProbeSampleModel{})
	return result.RowsAffected, mapError(result.Error)
}

// UpdateManualFlagMany rewrites the operator annotation on a batch; purely
// cosmetic evidence bookkeeping that never touches the strike machine.
func (r *ProbeSampleRepository) UpdateManualFlagMany(ctx context.Context, ids []uint64, flag string) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	result := r.db.db.WithContext(ctx).Model(&qualityProbeSampleModel{}).
		Where("id IN ?", ids).Update("manual_flag", flag)
	return result.RowsAffected, mapError(result.Error)
}

func (r *ProbeSampleRepository) DeleteMany(ctx context.Context, ids []uint64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	result := r.db.db.WithContext(ctx).Where("id IN ?", ids).Delete(&qualityProbeSampleModel{})
	return result.RowsAffected, mapError(result.Error)
}
