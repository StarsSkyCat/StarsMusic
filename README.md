# StarsMusic

Linux 优先的跨平台桌面音乐播放器，计划接入网易云音乐、酷狗音乐与本地音乐。

当前处于 P0 接入阶段：支持本地音频、网易云临时扫码登录与单曲播放，并已实现酷狗标准版 App 扫码、账号验证、歌单分页、曲目列表、流解析和单曲播放。网易云真实闭环已由用户确认出声；酷狗真实登录、私人歌单、曲目列表和部分歌曲出声已确认，部分曲目因平台返回不一致的 hash/时长或平台限制被拒绝/不可用。系统密钥持久化、目录扫描、持久音乐库和安装包尚未实现。具体范围见 [网易云说明](docs/netease.md)、[酷狗说明](docs/kugou.md) 与 [验证记录](docs/validation/2026-10-26-netease.md)。

- [产品设计与技术选型](docs/design-and-architecture.md)
- [开发文档索引](docs/README.md)
- [开发指南与环境](docs/development.md)
- [开发路线图](docs/roadmap.md)
- [协作规则](AGENTS.md) · [贡献流程](CONTRIBUTING.md)
- 技术路线：Electron + Vue 3 + TypeScript + mpv + SQLite。
- 第一阶段：验证两个平台的登录、歌单、播放闭环，以及 Linux 打包与桌面集成。

Windows、macOS 保留架构接口，安排在 Linux 版本稳定后实现。

## 启动与检查

需要 Node.js 24.x、pnpm 10.34.9；本地播放需要 Linux 与 PATH 中可运行的系统 mpv（本机验证 0.41.0）：

```bash
pnpm install --frozen-lockfile
pnpm setup:electron
pnpm dev
```

验证与运行构建产物：

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm test:playback
pnpm build
pnpm start
pnpm test:e2e
```

setup:electron 首次下载固定版本的 Electron 运行时，需要网络；dev/start/test:e2e 需要可用的图形会话。build 生成 out/ 下的应用代码，尚不生成安装包；类型检查单独执行。仅有 Node 时可直接运行 `node scripts/check.mjs` 检查文档和配置。若环境提供 Corepack，可用 `corepack pnpm` 替代 `pnpm`。依赖、缓存与验证细节见 [开发指南](docs/development.md)。

## 目录

- src/：桌面主进程、preload 和界面入口边界。
- packages/：公共契约、平台适配、播放、存储和系统集成。
- packaging/：后续 Linux 安装包配置。
- scripts/：仓库工具。
- docs/：设计、开发、验证与决策记录。

项目许可证尚未确定，发布前补充 LICENSE 与完整的第三方许可清单；当前直接依赖见 [依赖记录](docs/dependencies.md)。
网易云协议基线的来源与许可见 [第三方声明](THIRD_PARTY_NOTICES.md)。

本地播放的边界与实际验证范围见 [播放说明](docs/playback.md) 和 [P0 记录](docs/validation/2026-10-26-local-playback.md)。
