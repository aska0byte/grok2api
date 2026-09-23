package gateway

import (
	"strings"
	"testing"

	"github.com/chenyme/grok2api/backend/internal/domain/audit"
	egressapp "github.com/chenyme/grok2api/backend/internal/application/egress"
)

func TestAccountProbeHTMLLooksComplete(t *testing.T) {
	fullSVG := &strings.Builder{}
	fullSVG.WriteString("<svg xmlns=\"http://www.w3.org/2000/svg\">")
	fullSVG.WriteString(strings.Repeat("<path d=\""+strings.Repeat("M0 0 L1 1 ", 20)+"Z\"/>", 10))
	fullSVG.WriteString(strings.Repeat("<circle r=\"2\"/>", 5))
	fullSVG.WriteString(strings.Repeat("<rect width=\"4\"/>", 3))
	fullSVG.WriteString("</svg>")

	stubby := "<svg><circle r=\"2\"/><rect/></svg>"
	truncated := "<svg>" + strings.Repeat("<path d=\"M0 0 L1 1\"/>", 40)
	smallButClosed := "<svg><path/><circle/><rect/><line/><ellipse/><polygon/><polyline/><path/><circle/><rect/><line/><ellipse/></svg>"

	cases := []struct {
		name string
		out  string
		want bool
	}{
		{"full render", fullSVG.String(), true},
		{"stubby", stubby, false},
		{"truncated no close", truncated, false},
		{"small output under length floor", smallButClosed, false},
		{"empty", "", false},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			if got := accountProbeHTMLLooksComplete(item.out); got != item.want {
				t.Fatalf("accountProbeHTMLLooksComplete(%q) = %v, want %v", item.name, got, item.want)
			}
		})
	}
}

func TestProbeInitialSampleClassification(t *testing.T) {
	service := &Service{}
	tests := []struct {
		name   string
		result egressapp.AccountQualityProbeResult
		want   string
	}{
		{
			name:   "thinking observed passes",
			result: egressapp.AccountQualityProbeResult{ThinkingObserved: true},
			want:   audit.ProbeSampleClassPassed,
		},
		{
			name:   "overturned beats missing",
			result: egressapp.AccountQualityProbeResult{MissingThinking: false, Overturned: true, Confirmation: &egressapp.AccountQualityProbeResult{ThinkingObserved: true}},
			want:   audit.ProbeSampleClassOverturned,
		},
		{
			name:   "confirmed when confirmation still missed",
			result: egressapp.AccountQualityProbeResult{MissingThinking: true, Confirmation: &egressapp.AccountQualityProbeResult{ThinkingObserved: false}},
			want:   audit.ProbeSampleClassConfirmed,
		},
		{
			name:   "missing without a confirmation round",
			result: egressapp.AccountQualityProbeResult{MissingThinking: true},
			want:   audit.ProbeSampleClassMissing,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := service.probeInitialSampleClassification(test.result); got != test.want {
				t.Fatalf("probeInitialSampleClassification() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestProbeHTMLSampleClassification(t *testing.T) {
	service := &Service{}
	fullSVG := "<svg xmlns=\"http://www.w3.org/2000/svg\">" + strings.Repeat("<path d=\""+strings.Repeat("M0 0 L1 1 ", 20)+"Z\"/>", 10) + strings.Repeat("<circle r=\"2\"/>", 5) + "</svg>"
	if got := service.probeHTMLSampleClassification(fullSVG); got != audit.ProbeSampleClassPassed {
		t.Fatalf("complete render class = %q, want %q", got, audit.ProbeSampleClassPassed)
	}
	if got := service.probeHTMLSampleClassification("<svg><circle r=\"2\"/></svg>"); got != audit.ProbeSampleClassMissing {
		t.Fatalf("stubby render class = %q, want %q", got, audit.ProbeSampleClassMissing)
	}
}
