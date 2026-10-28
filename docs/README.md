# 文档

项目介绍与快速启动见 [README](../README.md)。本目录仅维护当前实现、使用条件和剩余限制。

| 文档 | 内容 |
| --- | --- |
| [开发指南](development.md) | 环境、运行命令、日常开发和打包入口 |
| [架构说明](architecture.md) | 模块边界、进程通信、播放与数据流 |
| [平台说明](platforms.md) | Linux / Windows 的环境、桌面行为与支持范围 |
| [平台接入](providers.md) | 网易云 / 酷狗的登录、歌单、权限与协议来源 |
| [安全与数据](security.md) | 凭据保存、本地文件、网络与 IPC 边界 |
| [测试说明](testing.md) | 验证命令、环境要求、历史实测摘要与待验收项 |
| [依赖清单](dependencies.md) | 直接依赖、版本、用途与第三方许可 |
| [路线图](roadmap.md) | 尚未完成的开发与发行工作 |

仓库级说明：[贡献指南](../CONTRIBUTING.md)、[安全报告](../SECURITY.md)、[打包说明](../packaging/README.md)、[第三方声明](../THIRD_PARTY_NOTICES.md)。licenses/ 保存需要随源码和安装包保留的第三方许可原文，不参与文档精简。

## 维护约定

- 功能变化更新对应主题；已实现、自动化验证和真实账号验收分别说明。
- 不为单次改动继续增加流水账、重复模块 README 或阶段模板；可复用的结论写入上述文档，执行细节写入提交或 PR。
- 本次整理前的方案、ADR 与逐次验证记录已合并。需要复查旧环境、产物校验值或决策过程时，使用 Git 历史查看原 docs/validation/、docs/adr/ 和相关主题文件。
- 文档修改运行 `pnpm check`；只有 Node.js 时可运行 `node scripts/check.mjs`。离线检查不验证外部链接或链接锚点。
