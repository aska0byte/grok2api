package qualityguard

import "errors"

var (
	ErrUnavailable   = errors.New("探测样本存储不可用")
	ErrInvalidInput  = errors.New("请求参数无效")
	ErrSampleMissing = errors.New("探测样本不存在")
)
