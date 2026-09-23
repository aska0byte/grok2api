package audit

import "time"

// Probe sample sources: who triggered the probe round.
const (
	ProbeSampleSourceManual    = "manual"
	ProbeSampleSourceScheduled = "scheduled"
)

// Probe sample rounds: the initial bound-node attempt and the second-chance
// temporary-proxy confirmation.
const (
	ProbeSampleRoundInitial = 1
	ProbeSampleRoundConfirm = 2
)

// Probe sample classifications, per attempt evidence:
//   - passed: the attempt observed reasoning
//   - missing: the attempt produced visible output without any thinking
//   - confirmed: the confirmation round repeated the missing-thinking result
//   - overturned: the confirmation round produced reasoning, rejecting the
//     initial missing-thinking verdict
const (
	ProbeSampleClassPassed     = "passed"
	ProbeSampleClassMissing    = "missing"
	ProbeSampleClassConfirmed  = "confirmed"
	ProbeSampleClassOverturned = "overturned"
)

// ProbeSampleAction mirrors the strike-machine consequence recorded on the
// initial sample: "", "cooled" or "disabled".
const (
	ProbeSampleActionNone     = ""
	ProbeSampleActionCooled   = "cooled"
	ProbeSampleActionDisabled = "disabled"
)

// Probe sample kinds: which probe baseline produced the sample.
//   - text: the reasoning probe (farmer puzzle), feeds the missing-thinking
//     strike machine
//   - html: the HTML generation probe (status card), visual + throughput
//     evidence only; never triggers strikes
const (
	ProbeSampleKindText = "text"
	ProbeSampleKindHTML = "html"
)

// Probe sample manual flags: the operator's own annotation on the gallery.
// It is purely bookkeeping and never feeds the strike machine.
const (
	ProbeSampleManualNone      = ""
	ProbeSampleManualSuspected = "suspected"
	ProbeSampleManualNormal    = "normal"
)

// ProbeSampleTextLimit caps stored response/reasoning text per sample.
const ProbeSampleTextLimit = 8 << 10

// ProbeSample is one stored probe attempt: the parsed response and reasoning
// text plus the automatic verdict, so operators can eyeball probe outcomes in
// the quality-guard sample gallery.
type ProbeSample struct {
	ID                    uint64
	RequestID             string
	Source                string
	Round                 int
	Kind                  string
	AccountID             uint64
	AccountName           string
	EgressNodeID          uint64
	EgressNodeName        string
	Model                 string
	Classification        string
	Action                string
	ManualFlag            string
	MissingThinking       bool
	ThinkingObserved      bool
	VisibleText           string
	VisibleTruncated      bool
	ReasoningText         string
	ReasoningTruncated    bool
	OutputTokens          int64
	ReasoningTokens       int64
	FirstTokenMS          int64
	DurationMS            int64
	OutputTokensPerSecond float64
	CreatedAt             time.Time
}

// ProbeSampleFilter paginates the quality-guard sample gallery.
type ProbeSampleFilter struct {
	AccountID      uint64
	Classification string
	Kind           string
	ManualFlag     string
	Search         string
	Page           int
	PageSize       int
}
