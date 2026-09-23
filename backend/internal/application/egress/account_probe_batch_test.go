package egress

import (
	"context"
	"errors"
	"testing"
)

func TestRunAccountQualityProbeBatchValidatesInput(t *testing.T) {
	service := NewService(nil, nil, "")
	if _, _, err := service.RunAccountQualityProbeBatch(context.Background(), nil, "text", 2, nil, nil); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("empty ids error = %v, want ErrInvalidInput", err)
	}
}

func TestRunAccountQualityProbeBatchStopsOnCancelledContext(t *testing.T) {
	service := NewService(nil, nil, "")
	service.SetQualityProber(&qualityProberStub{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	succeeded, failed, err := service.RunAccountQualityProbeBatch(ctx, []uint64{1, 2, 3}, "text", 2, nil, nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
	if succeeded != 0 || failed != 0 {
		t.Fatalf("counters = (%d, %d), want (0, 0)", succeeded, failed)
	}
}
