# 平台适配

src/netease 已实现固定协议、App 扫码、账号验证、私人歌单/曲目分页及流解析，用户已确认实际出声。src/kugou 已实现标准版 App 扫码、设备注册、账号验证、歌单/曲目分页和流解析；匿名与合成测试通过，真实账号闭环待验证。接口与限制见 [网易云说明](../../docs/netease.md) 与 [酷狗说明](../../docs/kugou.md)。

两个 Provider 在登录验证成功后通过窄消息导出白名单凭据 bundle，供主进程 CredentialVault 加密保存；恢复时重新请求账号接口验证，不能仅凭可解密进入 connected。

src/session-generation.ts 每个平台只保留一个活动租约；登录开始、账号验证完成或重登时 activate，退出/取消时 invalidate，旧成功与失败都丢弃。两个平台服务运行于各自专用 utilityProcess，凭据只存内存，页面不接触私有接口或流地址；本轮没有密钥后端或持久缓存。

按 [P0 计划](../../docs/roadmap.md) 推进；实际测试使用 [验证模板](../../docs/templates/p0-validation.md)，不提交凭据和个人响应。
