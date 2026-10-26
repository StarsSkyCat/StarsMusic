# 平台适配

后续分别实现网易云、酷狗与本地音乐 Provider，统一契约并保留平台/账号/客户端渠道边界。接口候选和真实登录尚未验证。

src/session-generation.ts 已实现后台 SessionGeneration 守卫。每个平台只保留一个活动租约；登录开始、账号验证完成、切账号/渠道或重登时通过 activate 生成新租约，退出/取消时通过 invalidate 取消并丢弃旧结果。只有 run/commit 能在检查当前租约后同步写回；具体约定见 [公共契约说明](../../docs/contracts.md)。本模块尚无平台网络请求、凭据服务或登录成功实现。

按 [P0 计划](../../docs/roadmap.md) 推进；实际测试使用 [验证模板](../../docs/templates/p0-validation.md)，不提交凭据和个人响应。
