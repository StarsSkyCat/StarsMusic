# 开发文档索引

| 文档 | 内容 |
| --- | --- |
| [产品设计与技术选型](design-and-architecture.md) | 产品范围、界面草案、技术比较、目标架构 |
| [开发指南](development.md) | 环境、可执行命令、目录边界和日常工作流 |
| [测试与验收](testing.md) | 当前检查、后续测试分层和 Linux 验收 |
| [开发路线图](roadmap.md) | 当前状态、P0 任务与完成标准 |
| [安全约定](security.md) | 登录、凭据、IPC、音频与本地数据保护 |
| [依赖记录](dependencies.md) | 当前直接依赖的固定版本、用途、许可和安装行为 |
| [桌面基础验证](validation/2026-10-26-desktop-foundation.md) | P0 第一步的实际验证结果与环境限制 |
| [公共契约](contracts.md) | 领域模型、后台流资源、错误分类和会话 generation 使用约定 |
| [公共契约验证](validation/2026-10-26-contracts-session.md) | P0 第二步的契约边界与异步竞态验证 |
| [本地播放](playback.md) | 私有 FD、状态源、切歌与应用退出规则 |
| [本地播放验证](validation/2026-10-26-local-playback.md) | P0 第三步的实际 mpv 与 PipeWire 桌面验证 |
| [网易云接入](netease.md) | 固定协议、临时扫码、歌单和 CDN 网关边界 |
| [网易云验证](validation/2026-10-26-netease.md) | 用户真实闭环结果、Fake-IP 修复及剩余矩阵 |
| [酷狗接入](kugou.md) | App 扫码、设备注册、歌单、流解析和渠道隔离 |
| [酷狗验证](validation/2026-10-26-kugou.md) | 匿名/合成检查结果与待完成的真实账号闭环 |
| [参考项目播放接入对照](reference-playback-comparison.md) | YesPlayMusic 与 Mineradio 的歌曲关联、登录渠道和权限处理源码核对 |
| [酷狗编码误拒修复](validation/2026-10-26-kugou-encoding.md) | 同曲不同编码的真实响应复现、资源关系验证与别名兼容 |
| [酷狗资源与权限排查](validation/2026-10-26-kugou-resource-access.md) | 分页漏歌、曲目身份、试听范围与 A/B 匿名核对的限制 |
| [凭据持久化](credentials.md) | 系统密钥保险库、记住登录、恢复、锁定与临时会话回退 |
| [凭据持久化验证](validation/2026-10-26-credentials.md) | 保险库自动化结果与本机密钥后端限制 |
| [音乐工作区验证](validation/2026-10-26-music-workspace.md) | 页面设计、多选下一首、会话队列与桌面布局检查 |
| [架构决策 ADR](adr/README.md) | 已选方向、备选方案和未验证的决策 |
| [P0 验证记录模板](templates/p0-validation.md) | 记录真实环境、操作、证据与限制 |

仓库协作规则见 [AGENTS.md](../AGENTS.md)，贡献流程见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

文档中的“计划”和待办不等于已实现；任务进度以路线图和相应验证记录为准。
