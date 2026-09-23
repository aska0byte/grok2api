package qualityguard

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	auditdomain "github.com/chenyme/grok2api/backend/internal/domain/audit"
	qualityguardapp "github.com/chenyme/grok2api/backend/internal/application/qualityguard"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"github.com/chenyme/grok2api/backend/internal/shared/response"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	service *qualityguardapp.Service
}

func NewHandler(service *qualityguardapp.Service) *Handler { return &Handler{service: service} }

// Register mounts the admin probe-sample gallery endpoints.
func (h *Handler) Register(router *gin.RouterGroup) {
	router.GET("/quality-guard/probe-samples", h.listSamples)
	router.GET("/quality-guard/probe-samples/:id", h.getSample)
	router.POST("/quality-guard/probe-samples/:id/manual-flag", h.markSample)
	router.POST("/quality-guard/probe-samples/manual-flag", h.markSamples)
	router.DELETE("/quality-guard/probe-samples/:id", h.deleteSample)
	router.DELETE("/quality-guard/probe-samples", h.deleteSamples)
}

type probeSampleItemResponse struct {
	ID                    uint64  `json:"id,string"`
	RequestID             string  `json:"requestId"`
	Source                string  `json:"source"`
	Round                 int     `json:"round"`
	Kind                  string  `json:"kind"`
	AccountID             uint64  `json:"accountId,string"`
	AccountName           string  `json:"accountName"`
	EgressNodeID          uint64  `json:"egressNodeId,string"`
	EgressNodeName        string  `json:"egressNodeName"`
	Model                 string  `json:"model"`
	Classification        string  `json:"classification"`
	Action                string  `json:"action,omitempty"`
	ManualFlag            string  `json:"manualFlag,omitempty"`
	MissingThinking       bool    `json:"missingThinking"`
	ThinkingObserved      bool    `json:"thinkingObserved"`
	VisiblePreview        string  `json:"visiblePreview"`
	VisibleLength         int     `json:"visibleLength"`
	ReasoningLength       int     `json:"reasoningLength"`
	OutputTokens          int64   `json:"outputTokens"`
	ReasoningTokens       int64   `json:"reasoningTokens"`
	FirstTokenMS          int64   `json:"firstTokenMs"`
	DurationMS            int64   `json:"durationMs"`
	OutputTokensPerSecond float64 `json:"outputTokensPerSecond"`
	CreatedAt             string  `json:"createdAt"`
}

type probeSampleDetailResponse struct {
	probeSampleItemResponse
	VisibleText        string `json:"visibleText"`
	VisibleTruncated   bool   `json:"visibleTruncated"`
	ReasoningText      string `json:"reasoningText"`
	ReasoningTruncated bool   `json:"reasoningTruncated"`
}

type probeSampleListResponse struct {
	Items    []probeSampleItemResponse `json:"items"`
	Total    int64                     `json:"total"`
	Page     int                       `json:"page"`
	PageSize int                       `json:"pageSize"`
}

func probeSampleItem(value auditdomain.ProbeSample) probeSampleItemResponse {
	visible := []rune(strings.TrimSpace(value.VisibleText))
	preview := visible
	// HTML samples embed the whole drawing; a 320-rune teaser renders as a
	// broken fragment inside the sandboxed preview iframe, so give them a
	// much larger budget.
	previewLimit := 320
	if value.Kind == "html" {
		previewLimit = 20000
	}
	if len(preview) > previewLimit {
		preview = preview[:previewLimit]
	}
	return probeSampleItemResponse{
		ID: value.ID, RequestID: value.RequestID, Source: value.Source, Round: value.Round, Kind: value.Kind,
		AccountID: value.AccountID, AccountName: value.AccountName,
		EgressNodeID: value.EgressNodeID, EgressNodeName: value.EgressNodeName,
		Model: value.Model, Classification: value.Classification, Action: value.Action, ManualFlag: value.ManualFlag,
		MissingThinking: value.MissingThinking, ThinkingObserved: value.ThinkingObserved,
		VisiblePreview:  string(preview),
		VisibleLength:   len(visible),
		ReasoningLength: len([]rune(value.ReasoningText)),
		OutputTokens:    value.OutputTokens, ReasoningTokens: value.ReasoningTokens,
		FirstTokenMS: value.FirstTokenMS, DurationMS: value.DurationMS,
		OutputTokensPerSecond: value.OutputTokensPerSecond,
		CreatedAt:             value.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
}

func (h *Handler) listSamples(c *gin.Context) {
	filter := auditdomain.ProbeSampleFilter{}
	if value, err := strconv.ParseUint(c.Query("accountId"), 10, 64); err == nil {
		filter.AccountID = value
	}
	filter.Classification = strings.TrimSpace(c.Query("classification"))
	filter.Kind = strings.TrimSpace(c.Query("kind"))
	filter.ManualFlag = strings.TrimSpace(c.Query("manualFlag"))
	filter.Search = strings.TrimSpace(c.Query("search"))
	if value, err := strconv.Atoi(c.Query("page")); err == nil && value > 0 {
		filter.Page = value
	}
	if value, err := strconv.Atoi(c.Query("pageSize")); err == nil && value > 0 {
		filter.PageSize = value
	}
	samples, total, err := h.service.ListProbeSamples(c.Request.Context(), filter)
	if err != nil {
		respondError(c, err)
		return
	}
	items := make([]probeSampleItemResponse, 0, len(samples))
	for _, value := range samples {
		items = append(items, probeSampleItem(value))
	}
	page, pageSize := filter.Page, filter.PageSize
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	response.Success(c, http.StatusOK, probeSampleListResponse{Items: items, Total: total, Page: page, PageSize: pageSize})
}

func (h *Handler) getSample(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		response.Error(c, http.StatusBadRequest, "invalidSampleId", "探测样本 ID 无效")
		return
	}
	value, err := h.service.GetProbeSample(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			response.Error(c, http.StatusNotFound, "probeSampleNotFound", "探测样本不存在")
			return
		}
		respondError(c, err)
		return
	}
	item := probeSampleItem(value)
	detail := probeSampleDetailResponse{
		probeSampleItemResponse: item,
		VisibleText:             value.VisibleText,
		VisibleTruncated:        value.VisibleTruncated,
		ReasoningText:           value.ReasoningText,
		ReasoningTruncated:      value.ReasoningTruncated,
	}
	response.Success(c, http.StatusOK, detail)
}

func respondError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, qualityguardapp.ErrUnavailable):
		response.Error(c, http.StatusServiceUnavailable, "probeSamplesUnavailable", "探测样本存储暂不可用")
	case errors.Is(err, qualityguardapp.ErrSampleMissing):
		response.Error(c, http.StatusNotFound, "probeSampleNotFound", "探测样本不存在")
	case errors.Is(err, qualityguardapp.ErrInvalidInput):
		response.Error(c, http.StatusBadRequest, "invalidRequest", err.Error())
	default:
		response.Error(c, http.StatusInternalServerError, "probeSamplesError", "读取探测样本失败")
	}
}

// probeSampleManualFlagRequest carries the operator annotation.
type probeSampleManualFlagRequest struct {
	Flag string `json:"flag"`
}

func (h *Handler) markSample(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		response.Error(c, http.StatusBadRequest, "invalidSampleId", "探测样本 ID 无效")
		return
	}
	var request probeSampleManualFlagRequest
	if c.Request.ContentLength != 0 {
		if c.ShouldBindJSON(&request) != nil {
			response.Error(c, http.StatusBadRequest, "invalidRequest", "请求参数无效")
			return
		}
	}
	value, err := h.service.MarkProbeSample(c.Request.Context(), id, strings.TrimSpace(request.Flag))
	if err != nil {
		respondError(c, err)
		return
	}
	response.Success(c, http.StatusOK, probeSampleItem(value))
}

// probeSampleBatchManualFlagRequest carries the batch operator annotation.
type probeSampleBatchManualFlagRequest struct {
	IDs  []string `json:"ids"`
	Flag string `json:"flag"`
}

// markSamples applies one operator annotation to a batch of samples; purely
// cosmetic evidence bookkeeping with no strike-machine side effects.
func (h *Handler) markSamples(c *gin.Context) {
	var request probeSampleBatchManualFlagRequest
	if c.ShouldBindJSON(&request) != nil {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "请求参数无效")
		return
	}
	ids := make([]uint64, 0, len(request.IDs))
	for _, raw := range request.IDs {
		parsed, err := strconv.ParseUint(strings.TrimSpace(raw), 10, 64)
		if err != nil || parsed == 0 {
			response.Error(c, http.StatusBadRequest, "invalidSampleId", "探测样本 ID 无效")
			return
		}
		ids = append(ids, parsed)
	}
	updated, err := h.service.MarkProbeSamples(c.Request.Context(), ids, strings.TrimSpace(request.Flag))
	if err != nil {
		respondError(c, err)
		return
	}
	response.Success(c, http.StatusOK, gin.H{"updated": updated})
}

func (h *Handler) deleteSample(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		response.Error(c, http.StatusBadRequest, "invalidSampleId", "探测样本 ID 无效")
		return
	}
	if _, err := h.service.DeleteProbeSample(c.Request.Context(), id); err != nil {
		respondError(c, err)
		return
	}
	response.Success(c, http.StatusOK, gin.H{"deleted": 1})
}

// probeSampleDeleteRequest carries the batch delete id list (string ids, the
// same wire format the gallery uses).
type probeSampleDeleteRequest struct {
	IDs []string `json:"ids"`
}

func (h *Handler) deleteSamples(c *gin.Context) {
	var request probeSampleDeleteRequest
	if c.ShouldBindJSON(&request) != nil {
		response.Error(c, http.StatusBadRequest, "invalidRequest", "请求参数无效")
		return
	}
	ids := make([]uint64, 0, len(request.IDs))
	for _, raw := range request.IDs {
		parsed, err := strconv.ParseUint(strings.TrimSpace(raw), 10, 64)
		if err != nil || parsed == 0 {
			response.Error(c, http.StatusBadRequest, "invalidSampleId", "探测样本 ID 无效")
			return
		}
		ids = append(ids, parsed)
	}
	deleted, err := h.service.DeleteProbeSamples(c.Request.Context(), ids)
	if err != nil {
		respondError(c, err)
		return
	}
	response.Success(c, http.StatusOK, gin.H{"deleted": deleted})
}
