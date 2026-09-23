package audit

const (
	DegradeClassBurst    = "buffered_burst"
	DegradeClassSoft     = "soft_tps"
	DegradeClassHard     = "hard_tps"
	DegradeClassThinking = "missing_thinking"
	ErrorQualityDegraded = "quality_degraded"
)

const (
	DefaultDegradeSoftTPS   = 500.0
	DefaultDegradeHardTPS   = 1000.0
	DefaultDegradeMinGenMS  = int64(1000)
	DefaultDegradeMinOutput = int64(32)
)

// ClassifyOutputSpeed matches the quality-guard panel formula:
// output tokens / GenerationWindowMS. In fail-closed mode, short generation
// windows with a soft-or-higher rate are buffered_burst; otherwise the hard
// and soft thresholds apply in that order.
func ClassifyOutputSpeed(outputTokens, reasoningTokens, firstTokenMS, durationMS int64, softTPS, hardTPS float64, minGenMS int64, failClosed bool) (class string, tps float64, genMS int64) {
	genMS = GenerationWindowMS(firstTokenMS, durationMS, reasoningTokens)
	if genMS <= 0 || outputTokens <= 0 {
		return "", 0, genMS
	}
	tps = OutputTokensPerSecond(outputTokens, reasoningTokens, firstTokenMS, durationMS)
	if failClosed && minGenMS > 0 && genMS < minGenMS && tps >= softTPS {
		return DegradeClassBurst, tps, genMS
	}
	if tps >= hardTPS {
		return DegradeClassHard, tps, genMS
	}
	if tps >= softTPS {
		return DegradeClassSoft, tps, genMS
	}
	return "", tps, genMS
}

// GenerationWindowMS is the Token/s denominator shared by the audit panel,
// dashboard, probes, and quality guard.
//
// Normally that is duration − first token. Older audit rows may have measured
// first token only when buffered reasoning was finally flushed. For rows that
// actually report reasoning tokens, use the full duration when the remaining
// tail is implausibly short. Rows without reasoning evidence retain the tail so
// real buffered output bursts remain visible to the fail-closed guard.
func GenerationWindowMS(firstTokenMS, durationMS, reasoningTokens int64) int64 {
	return GenerationWindowMSObserved(firstTokenMS, durationMS, reasoningTokens > 0)
}

// GenerationWindowMSObserved is GenerationWindowMS with an explicit
// reasoning-evidence override. Usage.reasoning_tokens is one evidence source;
// probe parsers also observe the reasoning-start stub and streamed reasoning
// delta text on streams whose usage never reports reasoning tokens. The same
// full-duration fallback applies so a buffered dump is not crushed into the
// flush window.
func GenerationWindowMSObserved(firstTokenMS, durationMS int64, reasoningObserved bool) int64 {
	if durationMS <= 0 {
		return 0
	}
	if firstTokenMS < 0 {
		firstTokenMS = 0
	}
	if firstTokenMS >= durationMS {
		return 0
	}
	generationMS := durationMS - firstTokenMS
	if reasoningObserved && generationMS < firstTokenMS && generationMS < DefaultDegradeMinGenMS {
		return durationMS
	}
	return generationMS
}

func OutputTokensPerSecond(outputTokens, reasoningTokens, firstTokenMS, durationMS int64) float64 {
	return OutputTokensPerSecondObserved(outputTokens, reasoningTokens, firstTokenMS, durationMS, reasoningTokens > 0)
}

// OutputTokensPerSecondObserved is OutputTokensPerSecond with an explicit
// reasoning-evidence override for stream parsers that know reasoning was
// claimed (the reasoning-start stub) or streamed (delta text) even when the
// usage frame reports zero reasoning tokens — 降智 upstreams emit exactly that
// shape, and their buffered flushes need the same window protection.
func OutputTokensPerSecondObserved(outputTokens, reasoningTokens, firstTokenMS, durationMS int64, reasoningObserved bool) float64 {
	generationMS := GenerationWindowMSObserved(firstTokenMS, durationMS, reasoningObserved)
	if outputTokens <= 0 || generationMS <= 0 {
		return 0
	}
	return float64(outputTokens) * 1000 / float64(generationMS)
}
