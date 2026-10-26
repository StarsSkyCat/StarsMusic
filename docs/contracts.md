# 公共契约与会话 generation

P0 第二步建立的纯 TypeScript 基础由 packages/contracts/src 定义，后台守卫由 packages/providers/src/session-generation.ts 实现。第四步的网易云服务和第五步的酷狗服务已实际使用这些基础；其白名单 DTO 与命令见 netease.ts、kugou.ts，具体范围见 [网易云说明](netease.md) 与 [酷狗说明](kugou.md)。不提供模拟成功的产品入口。

## 模型与校验

| 模型/入口 | 约定 |
| --- | --- |
| TrackRef / parseTrackRef | provider 为 netease、kugou 或 local；id 为非空 string，不接受数字转字符串；variant 保留曲目版本 |
| ProviderContext / parseProviderContext | 在线上下文必须指定平台对应渠道，accountId 可缺省为游客；本地上下文不携带账号或渠道 |
| contextKey | 平台、账号、渠道的 JSON 元组；不使用可碰撞的简单分隔符，不把游客与字符串账号混同 |
| LoginState / parseLoginState | 未登录、等待扫码/网页授权、待确认、验证中、已连接、过期、取消、失败；等待态必须有 challengeId |
| SessionStatus / parseSessionStatus | generation 为非负安全整数；仅 connected 携带 accountId，且必须 identityVerified=true、lastVerifiedAt 有效 |
| StreamResolution / parseStreamResolution | 后台资源解析；本地 fileId 必须匹配本地曲目 ID；在线资源与在线曲目匹配，不返回任意本地路径 |
| AppError / parseAppError | code 为白名单；message 与 retryable 由本地常量决定，不显示上游任意文本；酷狗取链身份不一致使用 track-mismatch |

解析入口接受 unknown，输出仅含明确字段并冻结对象；不原样转发未知字段。时间戳为 Unix 毫秒，试听 startMs/durationMs 为毫秒；码率为 kbps，采样率为 Hz。时间戳只作结构/范围校验，消费资源时仍必须检查是否已经过期。

当前渠道枚举是契约命名：netease-app、netease-web、kugou-app、kugou-web，不表示已经验证这些登录方式。酷狗两个渠道不能互换会话或缓存；当前只实现 kugou-app。

登录已连接只表明身份验证通过，不包含歌曲权限承诺。曲目仍需解析实际资源；access 明确区分 full 与 preview，quality.level 可为 unknown，不能根据会员或请求音质猜测实际音质。当前这些结构不构成完整 Provider 方法接口，搜索、歌单分页、歌词等在实际接入时按使用需求补充。

## 后台专用资源与错误

StreamResolution.source.remote 包含临时 URL、请求头和可选过期时间，仅在可信后台短时使用，不进入 renderer、日志、数据库或页面存储。远端 URL 必须为不含内嵌身份、片段和空白/控制字符的 HTTPS；请求头名称合法、值无非法控制字符，拒绝大小写重复头和 Host/Connection 等传输控制头。

通用检查只验证结构，不授权任意 HTTPS 目标。网易云与酷狗已分别增加严格 CDN/跳转传输策略、平台隔离的 loopback 网关与无凭据转发；其他渠道仍须独立核实。不能用通用契约校验代替实际平台验证。

适配器核实实际响应后才能抛出 DomainError 分类。normalizeError 不猜测未知上游对象中的 code 或 message；未知错误统一为 internal，契约校验失败为 invalid-response，AbortError/TimeoutError 映射取消/超时。权限拒绝、过期、网络、限流等分类有固定文案；retryable 仅为提示，不代表已实现自动重试。

## 后台租约与写回

SessionGeneration 每个平台只保留一个活动 SessionLease。租约包含冻结的上下文、递增 generation、AbortSignal，不含凭据。activate 必须在新登录开始、账号身份验证完成、切账号/渠道及同账号重登时调用；即便上下文完全相同也会取消旧租约。invalidate 用于退出、取消和会话过期。

同平台替换前先使旧租约失效，再同步发出 abort；不同平台互不取消。对象身份校验阻止伪造或其他守卫实例的同号租约被接受。

- run(lease, request, apply) 把租约 signal 交给请求，完成后仅在租约仍有效时同步执行 apply；过期成功与失败都返回 discarded，当前失败返回已归一化的 error。
- commit(lease, apply) 用于其他后台事件；只对当前租约执行同步写回，返回是否执行。
- apply 必须同步完成并返回 undefined，类型签名拒绝直接传入 async 回调。不能在回调中启动延迟写入，再假定它已受保护。
- 网络请求内只取数据，缓存/状态写入必须放在 apply。上游不响应 AbortSignal 时仍通过最终租约检查阻止旧结果覆盖。
- 缓存键捕获自租约上下文，不在请求结束后读取可能已经切换的当前账号。缓存数据本身的账号清理、容量与持久化尚未实现。

守卫自身不维护账号/凭据或自动清理资源。网易云与酷狗服务已在 invalidate 后清理临时凭据与列表，后台状态变化通知播放器停止相应在线音频；新渠道接入时必须落实各自清理与超时规则。

会话 generation 只处理账号生命周期，不能替代未来快速切歌需要的独立 playbackGeneration；同一账号内不同播放请求仍需独立隔离。跨进程接入时必须由拥有会话的后台服务进行最终检查，不把 IPC 反序列化后的租约当作同一对象。
