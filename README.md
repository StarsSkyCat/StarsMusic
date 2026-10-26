# StarsMusic

Linux 优先的跨平台桌面音乐播放器，计划接入网易云音乐、酷狗音乐与本地音乐。

当前处于仓库基础与 P0 准备阶段：已建立开发文档、规则、模块目录与基础检查；尚无可启动的桌面应用，也未完成真实账号登录及播放验证。

- [产品设计与技术选型](docs/design-and-architecture.md)
- [开发文档索引](docs/README.md)
- [开发指南与环境](docs/development.md)
- [开发路线图](docs/roadmap.md)
- [协作规则](AGENTS.md) · [贡献流程](CONTRIBUTING.md)
- 技术路线：Electron + Vue 3 + TypeScript + mpv + SQLite。
- 第一阶段：验证两个平台的登录、歌单、播放闭环，以及 Linux 打包与桌面集成。

Windows、macOS 保留架构接口，安排在 Linux 版本稳定后实现。

## 基础检查

需要 Node.js 24.x、pnpm 10.34.9：

```bash
pnpm install --frozen-lockfile
pnpm check
```

仅有 Node 时可直接运行 `node scripts/check.mjs` 检查文档和配置。若环境提供 Corepack，可用 `corepack pnpm` 替代 `pnpm`。当前尚无 dev/build/test 应用命令。

## 目录

- src/：桌面主进程、preload 和界面入口边界。
- packages/：公共契约、平台适配、播放、存储和系统集成。
- packaging/：后续 Linux 安装包配置。
- scripts/：仓库工具。
- docs/：设计、开发、验证与决策记录。

项目许可证尚未确定，发布前补充 LICENSE 与第三方许可清单。
