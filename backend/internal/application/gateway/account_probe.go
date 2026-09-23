package gateway

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	egressapp "github.com/chenyme/grok2api/backend/internal/application/egress"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	egressdomain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/repository"
)

const (
	defaultAccountProbeInterval  = 30 * time.Minute
	defaultAccountProbeModel     = "grok-4.6"
	defaultAccountProbePrompt    = "A farmer has 17 sheep. All but 9 run away. How many sheep are left? Think step by step."
	defaultAccountProbeMaxTokens = 512
	defaultAccountProbeBatch     = 5
	defaultAccountProbeWindow    = time.Hour
	defaultAccountProbeThreshold = 3
	defaultAccountProbeCooldown  = 12 * time.Hour
	// defaultAccountProbeSampleRetention keeps gallery samples for a week.
	defaultAccountProbeSampleRetention = 7 * 24 * time.Hour
	// accountProbeBoundScanLimit caps the full-rotation candidate list.
	accountProbeBoundScanLimit = 2000
	// accountProbeHTMLPrompt is the SVG pelican-on-a-bicycle baseline; the
	// detailed scene keeps strong renders in the 250-300 line range while
	// degraded accounts stay stubby.
	accountProbeHTMLPrompt = "用 SVG 画一只骑自行车的鹈鹕，包含车轮辐条、羽毛、背景等完整细节，输出完整 <svg> 代码"
	// accountProbeHTMLMaxTokens leaves headroom for path-dense 300-line SVGs.
	accountProbeHTMLMaxTokens = 8192
	// HTML render heuristics: a full-strength pelican scene spans thousands of
	// characters with dozens of drawable elements; degraded early-stopped
	// outputs truncate the tag tree or stay tiny.
	accountProbeHTMLMinCharacters  = 2000
	accountProbeHTMLMinSVGElements = 12
)

// accountProbeHTMLLooksComplete runs cheap completeness heuristics over the
// rendered SVG output: an advisory machine verdict only — it never feeds the
// strike machine, cooldowns, or the confirmation round.
func accountProbeHTMLLooksComplete(visible string) bool {
	if len(strings.TrimSpace(visible)) < accountProbeHTMLMinCharacters {
		return false
	}
	lower := strings.ToLower(visible)
	if !strings.Contains(lower, "</svg>") {
		return false
	}
	elements := 0
	for _, tag := range []string{"<path", "<circle", "<rect", "<line", "<ellipse", "<polygon", "<polyline"} {
		elements += strings.Count(lower, tag)
	}
	return elements >= accountProbeHTMLMinSVGElements
}

type AccountProbeRuntime struct {
	Enabled             bool
	ClientKeyID         uint64
	Interval            time.Duration
	Model               string
	Prompt              string
	MaxOutputTokens     int
	MaxAccountsPerRun   int
	CrossProxyWindow    time.Duration
	CrossProxyThreshold int
	AccountCooldown     time.Duration
	SampleRetention     time.Duration
}

func DefaultAccountProbeRuntime() AccountProbeRuntime {
	return AccountProbeRuntime{
		Enabled:             false,
		Interval:            defaultAccountProbeInterval,
		Model:               defaultAccountProbeModel,
		Prompt:              defaultAccountProbePrompt,
		MaxOutputTokens:     defaultAccountProbeMaxTokens,
		MaxAccountsPerRun:   defaultAccountProbeBatch,
		CrossProxyWindow:    defaultAccountProbeWindow,
		CrossProxyThreshold: defaultAccountProbeThreshold,
		AccountCooldown:     defaultAccountProbeCooldown,
		SampleRetention:     defaultAccountProbeSampleRetention,
	}
}

func (s *Service) ApplyAccountProbeRuntime(value AccountProbeRuntime) {
	if value.Interval <= 0 {
		value.Interval = defaultAccountProbeInterval
	}
	if value.MaxOutputTokens <= 0 {
		value.MaxOutputTokens = defaultAccountProbeMaxTokens
	}
	if value.MaxAccountsPerRun <= 0 {
		value.MaxAccountsPerRun = defaultAccountProbeBatch
	}
	if value.CrossProxyWindow <= 0 {
		value.CrossProxyWindow = defaultAccountProbeWindow
	}
	if value.CrossProxyThreshold <= 0 {
		value.CrossProxyThreshold = defaultAccountProbeThreshold
	}
	if value.AccountCooldown <= 0 {
		value.AccountCooldown = defaultAccountProbeCooldown
	}
	if value.SampleRetention <= 0 {
		value.SampleRetention = defaultAccountProbeSampleRetention
	}
	s.accountProbeConfig.Store(&value)
}

type accountProbeStrikeSource interface {
	ListMissingThinkingStrikes(context.Context, time.Time, int) ([]accountdomain.Credential, error)
}

type accountProbeAuditSource interface {
	SummarizeCrossProxySuspects(context.Context, time.Time, int, int) ([]repository.CrossProxySuspect, error)
}

// accountProbeNodeSource supplies healthy temporary proxies for the
// second-chance confirmation round.
type accountProbeNodeSource interface {
	ProbePoolNodes(context.Context) ([]egressdomain.Node, error)
}

// accountProbeBoundSource supplies the full-rotation candidate list: enabled
// Build accounts bound to a usable long-lived node.
type accountProbeBoundSource interface {
	ListEgressBoundAccounts(context.Context, int) ([]accountdomain.Credential, error)
}

// accountProbeSampleSink stores probe attempts for the quality-guard gallery.
type accountProbeSampleSink interface {
	Create(ctx context.Context, value audit.ProbeSample) (audit.ProbeSample, error)
	DeleteCreatedBefore(ctx context.Context, cutoff time.Time) (int64, error)
}

func (s *Service) SetAccountProbeStrikes(value accountProbeStrikeSource) { s.accountProbeStrikes = value }
func (s *Service) SetAccountProbeAudits(value accountProbeAuditSource)   { s.accountProbeAudits = value }
func (s *Service) SetAccountProbeNodes(value accountProbeNodeSource)     { s.accountProbeNodes = value }
func (s *Service) SetAccountProbeBoundAccounts(value accountProbeBoundSource) {
	s.accountProbeBound = value
}
func (s *Service) SetAccountProbeSamples(value accountProbeSampleSink) {
	s.accountProbeSamples = value
}

// accountProbeAttempt carries one attempt's parsed result plus the raw
// visible/reasoning text captured for the sample gallery.
type accountProbeAttempt struct {
	Result        egressapp.AccountQualityProbeResult
	VisibleText   string
	ReasoningText string
}

// AccountProbeDefaults exposes the configured probe payload so manual probes
// (e.g. the degrade panel button) can omit clientKeyID/model/prompt.
func (s *Service) AccountProbeDefaults() egressapp.QualityProbeInput {
	cfg := s.accountProbeConfig.Load()
	if cfg == nil {
		return egressapp.QualityProbeInput{}
	}
	return egressapp.QualityProbeInput{
		ClientKeyID: cfg.ClientKeyID, Model: cfg.Model, Prompt: cfg.Prompt, MaxOutputTokens: cfg.MaxOutputTokens,
	}
}

// accountProbeCandidate pairs an account with the long-lived node it must be
// probed through.
type accountProbeCandidate struct {
	AccountID uint64
	NodeID    uint64
	Source    string
}

// normalizeAccountProbeKind validates the requested probe baseline: the
// reasoning text probe (default) or the HTML generation probe.
func normalizeAccountProbeKind(kind string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "", audit.ProbeSampleKindText:
		return audit.ProbeSampleKindText, nil
	case audit.ProbeSampleKindHTML:
		return audit.ProbeSampleKindHTML, nil
	default:
		return "", fmt.Errorf("%w: 探测方式仅支持 text 或 html", egressapp.ErrInvalidInput)
	}
}

// ProbeAccountQuality pins one probe to a single account through its bound
// long-lived egress node. A missing-thinking verdict triggers one
// second-chance re-test through a random temporary proxy: thinking on the
// fresh IP overturns the verdict (the bound node/IP was at fault), a repeated
// miss confirms the account and applies the strike machine — first hit cools
// the account down, a second hit after the cooldown disables it (and releases
// its long-lived proxy binding). The html kind runs the HTML generation
// baseline: a stubby or truncated render is 疑似降智 and drives the same
// strike machine after one confirmation round; a complete render (or a
// complete confirmation render on the fresh IP) clears strike history.
func (s *Service) ProbeAccountQuality(ctx context.Context, accountID, nodeID uint64, input egressapp.QualityProbeInput, source string) (egressapp.AccountQualityProbeResult, error) {
	if accountID == 0 || nodeID == 0 {
		return egressapp.AccountQualityProbeResult{}, fmt.Errorf("%w: accountId 和 nodeId 必填", egressapp.ErrInvalidInput)
	}
	if source != audit.ProbeSampleSourceScheduled {
		source = audit.ProbeSampleSourceManual
	}
	kind, kindErr := normalizeAccountProbeKind(input.Kind)
	if kindErr != nil {
		return egressapp.AccountQualityProbeResult{}, kindErr
	}
	input.Kind = kind
	if kind == audit.ProbeSampleKindHTML {
		input.Prompt = accountProbeHTMLPrompt
		if input.MaxOutputTokens < accountProbeHTMLMaxTokens {
			input.MaxOutputTokens = accountProbeHTMLMaxTokens
		}
	}
	attempt, err := s.runAccountProbeAttempt(ctx, accountID, nodeID, input)
	if err != nil {
		return egressapp.AccountQualityProbeResult{}, err
	}
	probe := attempt.Result
	if kind == audit.ProbeSampleKindHTML {
		// Completeness verdict: a stubby or truncated render is 疑似降智 and
		// drives the strike machine after one second-chance render through a
		// random temporary proxy — a complete confirmation render on the
		// fresh IP overturns the verdict (the bound node/IP was at fault).
		classification := audit.ProbeSampleClassPassed
		if !accountProbeHTMLLooksComplete(attempt.VisibleText) {
			classification = audit.ProbeSampleClassMissing
			if confirmation := s.confirmAccountProbe(ctx, accountID, input); confirmation != nil {
				probe.Confirmation = &confirmation.Result
				if accountProbeHTMLLooksComplete(confirmation.VisibleText) {
					classification = audit.ProbeSampleClassOverturned
				} else {
					classification = audit.ProbeSampleClassConfirmed
				}
				s.saveAccountProbeSample(ctx, source, *confirmation, audit.ProbeSampleRoundConfirm, s.probeHTMLSampleClassification(confirmation.VisibleText), audit.ProbeSampleActionNone)
			}
		}
		action := audit.ProbeSampleActionNone
		if classification == audit.ProbeSampleClassMissing || classification == audit.ProbeSampleClassConfirmed {
			action = s.applyAccountProbeStrike(ctx, accountID)
		} else if classification == audit.ProbeSampleClassPassed || classification == audit.ProbeSampleClassOverturned {
			s.clearAccountProbeStrikes(ctx, accountID)
		}
		probe.Action = action
		s.saveAccountProbeSample(ctx, source, attempt, audit.ProbeSampleRoundInitial, classification, action)
		return probe, nil
	}
	if probe.MissingThinking {
		confirmation := s.confirmAccountProbe(ctx, accountID, input)
		if confirmation != nil {
			probe.Confirmation = &confirmation.Result
			if confirmation.Result.ThinkingObserved {
				// The fresh exit IP produced reasoning: the account is fine,
				// the bound node/IP was the problem. Reject the verdict.
				probe.MissingThinking = false
				probe.Overturned = true
				s.logger.Info("account_probe_overturned",
					"account_id", accountID, "bound_node_id", nodeID,
					"confirm_node_id", confirmation.Result.NodeID, "confirm_request_id", confirmation.Result.RequestID)
			}
			s.saveAccountProbeSample(ctx, source, *confirmation, audit.ProbeSampleRoundConfirm, s.probeSampleClassification(confirmation.Result), "")
		}
	}
	// Strike state follows the final verdict only: a cooled/disabled history
	// is cleared when the account demonstrably thinks on the fresh IP.
	if probe.MissingThinking {
		probe.Action = s.applyAccountProbeStrike(ctx, accountID)
	} else if probe.ThinkingObserved || probe.Overturned {
		s.clearAccountProbeStrikes(ctx, accountID)
	}
	s.saveAccountProbeSample(ctx, source, attempt, audit.ProbeSampleRoundInitial, s.probeInitialSampleClassification(probe), probe.Action)
	return probe, nil
}

// probeSampleClassification classifies one attempt by its own evidence:
// thinking observed means the sample passed; otherwise it is missing.
func (s *Service) probeSampleClassification(result egressapp.AccountQualityProbeResult) string {
	if result.ThinkingObserved {
		return audit.ProbeSampleClassPassed
	}
	return audit.ProbeSampleClassMissing
}

// probeSampleClassification stays on the confirm sample (passed/missing); the
// initial sample folds the confirmation outcome into confirmed/overturned.
func (s *Service) probeInitialSampleClassification(result egressapp.AccountQualityProbeResult) string {
	if result.ThinkingObserved {
		return audit.ProbeSampleClassPassed
	}
	if result.Overturned {
		return audit.ProbeSampleClassOverturned
	}
	if result.MissingThinking && result.Confirmation != nil {
		return audit.ProbeSampleClassConfirmed
	}
	return audit.ProbeSampleClassMissing
}

// probeHTMLSampleClassification classifies an HTML attempt by render
// completeness only (no thinking semantics).
func (s *Service) probeHTMLSampleClassification(visible string) string {
	if accountProbeHTMLLooksComplete(visible) {
		return audit.ProbeSampleClassPassed
	}
	return audit.ProbeSampleClassMissing
}

// applyAccountProbeStrike feeds a failed probe verdict into the strike
// machine: the first hit cools the account down, a second hit after the
// cooldown disables it. The returned action mirrors ProbeSampleAction values.
func (s *Service) applyAccountProbeStrike(ctx context.Context, accountID uint64) string {
	penalty, penaltyErr := s.selector.MarkAccountMissingThinking(ctx, accountdomain.ProviderBuild, accountID, s.accountProbeCooldown())
	if penaltyErr != nil {
		s.logger.Warn("account_probe_strike_failed", "account_id", accountID, "error", penaltyErr)
		return audit.ProbeSampleActionNone
	}
	switch penalty {
	case missingThinkingPenaltyDisabled:
		return audit.ProbeSampleActionDisabled
	case missingThinkingPenaltyCooled:
		return audit.ProbeSampleActionCooled
	}
	return audit.ProbeSampleActionNone
}

// clearAccountProbeStrikes removes strike history and cooldown after a probe
// demonstrated a healthy account.
func (s *Service) clearAccountProbeStrikes(ctx context.Context, accountID uint64) {
	if clearErr := s.selector.ClearAccountMissingThinking(ctx, accountdomain.ProviderBuild, accountID); clearErr != nil {
		s.logger.Warn("account_probe_clear_strike_failed", "account_id", accountID, "error", clearErr)
	}
}

// saveAccountProbeSample persists one attempt for the gallery; storage
// failures never affect the probe verdict.
func (s *Service) saveAccountProbeSample(ctx context.Context, source string, attempt accountProbeAttempt, round int, classification, action string) {
	if s.accountProbeSamples == nil {
		return
	}
	visibleText, visibleTruncated := probeSampleText(attempt.VisibleText)
	reasoningText, reasoningTruncated := probeSampleText(attempt.ReasoningText)
	sample := audit.ProbeSample{
		RequestID: attempt.Result.RequestID, Source: source, Round: round,
		Kind: attempt.Result.Kind,
		AccountID: attempt.Result.AccountID, EgressNodeID: attempt.Result.NodeID,
		Model: attempt.Result.Model, Classification: classification, Action: action,
		MissingThinking: attempt.Result.MissingThinking, ThinkingObserved: attempt.Result.ThinkingObserved,
		VisibleText: visibleText, VisibleTruncated: visibleTruncated,
		ReasoningText: reasoningText, ReasoningTruncated: reasoningTruncated,
		OutputTokens: attempt.Result.OutputTokens, ReasoningTokens: attempt.Result.ReasoningTokens,
		FirstTokenMS: attempt.Result.FirstTokenMS, DurationMS: attempt.Result.DurationMS,
		OutputTokensPerSecond: attempt.Result.OutputTokensPerSecond,
		CreatedAt:             time.Now().UTC(),
	}
	if _, err := s.accountProbeSamples.Create(ctx, sample); err != nil {
		s.logger.Warn("account_probe_sample_failed", "account_id", attempt.Result.AccountID, "request_id", attempt.Result.RequestID, "error", err)
	}
}

func probeSampleText(value string) (string, bool) {
	runes := []rune(value)
	if len(runes) <= audit.ProbeSampleTextLimit {
		return value, false
	}
	return string(runes[:audit.ProbeSampleTextLimit]), true
}

// confirmAccountProbe re-tests the account through one random healthy
// temporary proxy. A nil return means no confirmation ran (no pool, pool
// error, or request failure) and the original verdict stands.
func (s *Service) confirmAccountProbe(ctx context.Context, accountID uint64, input egressapp.QualityProbeInput) *accountProbeAttempt {
	if s.accountProbeNodes == nil {
		return nil
	}
	pool, err := s.accountProbeNodes.ProbePoolNodes(ctx)
	if err != nil {
		s.logger.Warn("account_probe_confirm_pool_unavailable", "account_id", accountID, "error", err)
		return nil
	}
	if len(pool) == 0 {
		s.logger.Debug("account_probe_confirm_pool_empty", "account_id", accountID)
		return nil
	}
	node := pool[rand.Intn(len(pool))]
	confirmation, err := s.runAccountProbeAttempt(ctx, accountID, node.ID, input)
	if err != nil {
		s.logger.Debug("account_probe_confirm_failed", "account_id", accountID, "node_id", node.ID, "error", err)
		return nil
	}
	return &confirmation
}

// runAccountProbeAttempt sends one pinned streaming probe request and parses
// reasoning evidence. It applies no strike state.
// ensureProbeClientKey resolves the client key used by account probes:
// explicit request value first, then the configured internal identity
// (qualityGuard.accountProbe.clientKeyID), then the built-in quality-guard
// identity (created and enabled on demand).
func (s *Service) ensureProbeClientKey(ctx context.Context, requested uint64) uint64 {
	if requested != 0 {
		return requested
	}
	if cfg := s.accountProbeConfig.Load(); cfg != nil && cfg.ClientKeyID > 0 {
		return cfg.ClientKeyID
	}
	identity, err := s.clientKeys.EnsureQualityGuardIdentity(ctx, true)
	if err != nil {
		s.logger.Warn("account_probe_identity_failed", "error", err)
		return 0
	}
	return identity.ID
}

func (s *Service) runAccountProbeAttempt(ctx context.Context, accountID, nodeID uint64, input egressapp.QualityProbeInput) (accountProbeAttempt, error) {
	probeKeyID := s.ensureProbeClientKey(ctx, input.ClientKeyID)
	if probeKeyID == 0 {
		return accountProbeAttempt{}, fmt.Errorf("%w: 未配置探测 Client Key，且内部质量探测身份不可用", egressapp.ErrInvalidInput)
	}
	key, err := s.clientKeys.Get(ctx, probeKeyID)
	if err != nil {
		s.logger.Warn("account_probe_failed", "account_id", accountID, "node_id", nodeID, "stage", "client_key", "error", err)
		return accountProbeAttempt{}, fmt.Errorf("读取质量探测 Client Key: %w", err)
	}
	if !key.IsAvailable(time.Now().UTC()) {
		return accountProbeAttempt{}, fmt.Errorf("质量探测 Client Key 已禁用或过期")
	}
	requestIDPart, err := security.NewOpaqueToken(12)
	if err != nil {
		return accountProbeAttempt{}, err
	}
	requestID := "quality_acct_" + requestIDPart
	body, err := json.Marshal(map[string]any{
		"model":          input.Model,
		"messages":       []map[string]string{{"role": "user", "content": input.Prompt}},
		"stream":         true,
		"stream_options": map[string]bool{"include_usage": true},
		"max_tokens":     input.MaxOutputTokens,
	})
	if err != nil {
		return accountProbeAttempt{}, err
	}

	startedAt := time.Now()
	publicModel, ok := qualityProbeBuildPublicModel(input.Model)
	if !ok {
		return accountProbeAttempt{}, fmt.Errorf("%w: 账号探测模型必须属于 Grok Build", egressapp.ErrInvalidInput)
	}
	result, err := s.CreateChatCompletion(ctx, Input{
		RequestID: requestID, ClientKey: key, PublicModel: publicModel, Body: body,
		Streaming: true, Operation: audit.OperationChat,
		ForcedEgressNodeID: nodeID, ForcedAccountID: accountID,
		QualityProbe: true,
	})
	if err != nil {
		s.logger.Warn("account_probe_failed", "account_id", accountID, "node_id", nodeID, "request_id", requestID, "model", input.Model, "error", err)
		return accountProbeAttempt{}, normalizeQualityProbeRequestError(err)
	}
	defer result.Body.Close()

	usage := Usage{}
	responseID := ""
	errorCode := ""
	defer func() { result.Finalize(usage, responseID, errorCode) }()
	if result.StatusCode < http.StatusOK || result.StatusCode >= http.StatusMultipleChoices {
		errorCode = "quality_probe_upstream_error"
		raw, _ := io.ReadAll(io.LimitReader(result.Body, 32<<10))
		return accountProbeAttempt{}, fmt.Errorf("账号探测上游返回 %d: %s", result.StatusCode, strings.TrimSpace(string(raw)))
	}

	var firstGeneratedAt time.Time
	var visible strings.Builder
	var reasoning strings.Builder
	reasoningStart := false
	totalBytes := 0
	terminal := false
	scanner := bufio.NewScanner(result.Body)
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	for scanner.Scan() {
		line := scanner.Bytes()
		totalBytes += len(line) + 1
		if totalBytes > qualityProbeMaxStreamBytes {
			errorCode = "quality_probe_response_too_large"
			return accountProbeAttempt{}, fmt.Errorf("账号探测响应超过 %d MiB", qualityProbeMaxStreamBytes>>20)
		}
		line = []byte(strings.TrimSpace(string(line)))
		if bytes.Equal(line, []byte(": grok2api-reasoning-start")) {
			reasoningStart = true
			if firstGeneratedAt.IsZero() {
				firstGeneratedAt = time.Now()
				if result.MarkFirstToken != nil {
					result.MarkFirstToken()
				}
			}
			continue
		}
		if !strings.HasPrefix(string(line), "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(string(line), "data:"))
		if payload == "[DONE]" {
			terminal = true
			break
		}
		var event qualityProbeChatEvent
		if json.Unmarshal([]byte(payload), &event) != nil {
			continue
		}
		if responseID == "" {
			responseID = event.ID
		}
		if event.Usage != nil {
			usage.Reported = true
			usage.InputTokens = event.Usage.PromptTokens
			usage.OutputTokens = event.Usage.CompletionTokens
			usage.ReasoningTokens = event.Usage.CompletionTokensDetails.ReasoningTokens
			usage.TotalTokens = event.Usage.TotalTokens
			usage.ResponseModel = event.Model
		}
		for _, choice := range event.Choices {
			delta := choice.Delta
			if delta.Reasoning != "" {
				reasoning.WriteString(delta.Reasoning)
			}
			if delta.ReasoningContent != "" {
				reasoning.WriteString(delta.ReasoningContent)
			}
			if delta.ThinkingContent != "" {
				reasoning.WriteString(delta.ThinkingContent)
			}
			generated := qualityProbeHasGeneratedDelta(delta.Content, delta.Reasoning, delta.ReasoningContent, delta.ThinkingContent)
			if generated && firstGeneratedAt.IsZero() {
				firstGeneratedAt = time.Now()
				if result.MarkFirstToken != nil {
					result.MarkFirstToken()
				}
			}
			if delta.Content != "" {
				visible.WriteString(delta.Content)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		errorCode = "quality_probe_stream_interrupted"
		return accountProbeAttempt{}, fmt.Errorf("读取账号探测流: %w", err)
	}
	if !terminal {
		errorCode = "quality_probe_stream_incomplete"
		return accountProbeAttempt{}, errors.New("账号探测流未正常结束")
	}

	completedAt := time.Now()
	text := visible.String()
	visibleCharacters := utf8.RuneCountInString(text)
	// Only streamed reasoning delta text is proof of thinking. The Chat SSE
	// stub and usage.reasoning_tokens are not: 降智 upstreams emit the stub
	// then dump visible tokens (usage 0), and can fill reasoning_tokens
	// without ever streaming a reasoning delta — same evidence standard as
	// ClassifyQualityHold.
	thinkingObserved := reasoning.Len() > 0
	// The HTML baseline carries no missing-thinking semantics: the card can
	// complete without any reasoning stream, so only the text kind can miss.
	missingThinking := input.Kind != audit.ProbeSampleKindHTML &&
		visibleCharacters > 0 && !thinkingObserved
	var firstTokenMS int64
	if !firstGeneratedAt.IsZero() {
		firstTokenMS = firstGeneratedAt.Sub(startedAt).Milliseconds()
	}
	durationMS := completedAt.Sub(startedAt).Milliseconds()
	var outputTokensPerSecond float64
	if !firstGeneratedAt.IsZero() {
		// Weaker than the verdict evidence above: a claimed or streamed
		// reasoning (stub, delta text, or usage tokens) widens the TPS window
		// to the full duration so a buffered flush is not crushed into the
		// tail — the 降智 stub+dump shape reports huge tok/s otherwise.
		reasoningEvidence := reasoningStart || reasoning.Len() > 0 || usage.ReasoningTokens > 0
		outputTokensPerSecond = qualityProbeOutputTokensPerSecond(usage.OutputTokens, usage.ReasoningTokens, durationMS, firstTokenMS, reasoningEvidence)
	}
	return accountProbeAttempt{
		Result: egressapp.AccountQualityProbeResult{
			RequestID: requestID, AccountID: accountID, NodeID: nodeID, Model: input.Model, Kind: input.Kind, StatusCode: result.StatusCode,
			FirstTokenMS: firstTokenMS, DurationMS: durationMS,
			OutputTokens: usage.OutputTokens, ReasoningTokens: usage.ReasoningTokens,
			VisibleCharacters: visibleCharacters, OutputTokensPerSecond: outputTokensPerSecond,
			ThinkingObserved: thinkingObserved, MissingThinking: missingThinking,
		},
		VisibleText:   text,
		ReasoningText: reasoning.String(),
	}, nil
}

func (s *Service) accountProbeCooldown() time.Duration {
	if cfg := s.accountProbeConfig.Load(); cfg != nil && cfg.AccountCooldown > 0 {
		return cfg.AccountCooldown
	}
	return 0
}

// cleanupProbeSamples prunes expired gallery samples once per scan tick.
func (s *Service) cleanupProbeSamples(ctx context.Context, cfg AccountProbeRuntime) {
	if s.accountProbeSamples == nil || cfg.SampleRetention <= 0 {
		return
	}
	deleted, err := s.accountProbeSamples.DeleteCreatedBefore(ctx, time.Now().UTC().Add(-cfg.SampleRetention))
	if err != nil {
		s.logger.Warn("account_probe_sample_cleanup_failed", "error", err)
		return
	}
	if deleted > 0 {
		s.logger.Debug("account_probe_samples_pruned", "deleted", deleted)
	}
}

// RunAccountProbeScan re-tests missing-thinking strike holders and cross-proxy
// suspects first, then rotates through every enabled Build account bound to a
// usable long-lived node. Each probe runs through the account's own bound
// node; unbound accounts are never probed. Connection failures are logged and
// skipped so only real responses produce verdicts. The scan is rate-limited
// by the configured interval; the caller may tick more frequently.
func (s *Service) RunAccountProbeScan(ctx context.Context) error {
	cfgValue := s.accountProbeConfig.Load()
	if cfgValue == nil || !cfgValue.Enabled || cfgValue.ClientKeyID == 0 || strings.TrimSpace(cfgValue.Model) == "" {
		return nil
	}
	cfg := *cfgValue
	if !s.qualityGuardRuntimeEnabled() {
		return nil
	}
	now := time.Now().Unix()
	if last := s.accountProbeLastScan.Load(); last > 0 && now-last < int64(cfg.Interval/time.Second) {
		return nil
	}
	s.accountProbeLastScan.Store(now)
	s.cleanupProbeSamples(ctx, cfg)
	batch := cfg.MaxAccountsPerRun
	if batch <= 0 {
		batch = defaultAccountProbeBatch
	}
	for _, candidate := range s.accountProbeCandidates(ctx, cfg, batch) {
		if ctx.Err() != nil {
			return nil
		}
		result, probeErr := s.ProbeAccountQuality(ctx, candidate.AccountID, candidate.NodeID, egressapp.QualityProbeInput{
			ClientKeyID: cfg.ClientKeyID, Model: cfg.Model, Prompt: cfg.Prompt, MaxOutputTokens: cfg.MaxOutputTokens,
		}, audit.ProbeSampleSourceScheduled)
		if probeErr != nil {
			s.logger.Debug("account_probe_request_failed",
				"account_id", candidate.AccountID, "node_id", candidate.NodeID, "source", candidate.Source, "error", probeErr)
			continue
		}
		fields := []any{"account_id", candidate.AccountID, "request_id", result.RequestID, "node_id", candidate.NodeID, "source", candidate.Source}
		switch {
		case result.Overturned && result.Confirmation != nil:
			s.logger.Info("account_probe_overturned",
				append(fields, "confirm_node_id", result.Confirmation.NodeID, "confirm_request_id", result.Confirmation.RequestID)...)
		case result.Action == "disabled":
			s.logger.Warn("account_probe_missing_thinking_disabled", fields...)
		case result.Action == "cooled":
			s.logger.Warn("account_probe_missing_thinking_cooled", fields...)
		default:
			s.logger.Info("account_probe_passed", append(fields, "tps", result.OutputTokensPerSecond)...)
		}
	}
	return nil
}

// accountProbeCandidates merges the probe sources in priority order: strike
// holders, cross-proxy suspects, then the full bound-account rotation that
// fills the rest of the batch. Unbound accounts are skipped everywhere.
func (s *Service) accountProbeCandidates(ctx context.Context, cfg AccountProbeRuntime, batch int) []accountProbeCandidate {
	seen := make(map[uint64]struct{}, batch)
	candidates := make([]accountProbeCandidate, 0, batch)
	add := func(accountID, nodeID uint64, source string) {
		if accountID == 0 || nodeID == 0 || len(candidates) >= batch {
			return
		}
		if _, exists := seen[accountID]; exists {
			return
		}
		seen[accountID] = struct{}{}
		candidates = append(candidates, accountProbeCandidate{AccountID: accountID, NodeID: nodeID, Source: source})
	}
	if s.accountProbeStrikes != nil {
		strikes, err := s.accountProbeStrikes.ListMissingThinkingStrikes(ctx, time.Now().UTC(), batch)
		if err != nil {
			s.logger.Warn("account_probe_strike_candidates_failed", "error", err)
		} else {
			for _, credential := range strikes {
				add(credential.ID, credential.EgressNodeID, "strike")
			}
		}
	}
	if s.accountProbeAudits != nil && cfg.CrossProxyThreshold > 0 && len(candidates) < batch {
		suspects, err := s.accountProbeAudits.SummarizeCrossProxySuspects(ctx, time.Now().UTC().Add(-cfg.CrossProxyWindow), cfg.CrossProxyThreshold, batch)
		if err != nil {
			s.logger.Warn("account_probe_suspects_failed", "error", err)
		} else {
			for _, suspect := range suspects {
				add(suspect.AccountID, suspect.NodeID, "suspect")
			}
		}
	}
	if s.accountProbeBound != nil && len(candidates) < batch {
		bound, err := s.accountProbeBound.ListEgressBoundAccounts(ctx, accountProbeBoundScanLimit)
		if err != nil {
			s.logger.Warn("account_probe_bound_candidates_failed", "error", err)
		} else if len(bound) > 0 {
			offset := int(s.accountProbeCursor.Add(int64(batch)) % int64(len(bound)))
			if offset < 0 {
				offset = 0
			}
			for index := 0; index < len(bound) && len(candidates) < batch; index++ {
				credential := bound[(offset+index)%len(bound)]
				add(credential.ID, credential.EgressNodeID, "rotation")
			}
		}
	}
	return candidates
}
