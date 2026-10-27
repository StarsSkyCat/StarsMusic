# StarsMusic

Linux 优先的跨平台桌面音乐播放器，计划接入网易云音乐、酷狗音乐与本地音乐。

当前处于 P0 接入阶段：支持本地音频、网易云扫码登录、热歌榜、分类公开歌单、歌曲/歌单搜索与播放，并已实现酷狗标准版 App 扫码、账号验证、歌单分页、曲目列表、流解析和单曲播放。网易云真实闭环已由用户确认出声；酷狗真实登录、私人歌单、曲目列表和部分歌曲出声已确认，取链已改为只按主 hash 解析以修复名称/声音错配，部分曲目仍因平台权限/资源限制不可用。已实现二维码区域按平台选择的 SQLite 加密“记住登录”（退出即删），使用应用管理的本地随机密钥，不依赖系统密钥服务；真实账号跨重启仍待用户验收。目录扫描、持久音乐库和安装包尚未实现。具体范围见 [网易云说明](docs/netease.md)、[酷狗说明](docs/kugou.md)、[凭据持久化](docs/credentials.md) 与 [验证记录](docs/validation/2026-10-26-netease.md)。

- [产品设计与技术选型](docs/design-and-architecture.md)
- [开发文档索引](docs/README.md)
- [开发指南与环境](docs/development.md)
- [Linux 桌面集成与能力状态](docs/linux-desktop.md)
- [开发路线图](docs/roadmap.md)
- [协作规则](AGENTS.md) · [贡献流程](CONTRIBUTING.md)
- 技术路线：Electron + Vue 3 + TypeScript + mpv + SQLite。
- 第一阶段：验证两个平台的登录、歌单、播放闭环，以及 Linux 打包与桌面集成。

Linux 已通过平台适配层接入 MPRIS、通知、托盘和快捷键；设置页按实际 D-Bus/宿主/portal 响应显示能力，Wayland 全局键需确认绑定，缺失服务时保留窗口和退出路径。范围见 [桌面集成](docs/linux-desktop.md)。

Windows、macOS 保留架构接口，安排在 Linux 版本稳定后实现。

底栏通过一个按钮依次切换列表循环 / 随机播放 / 单曲循环，图标和提示显示当前模式；模式随队列保存，并与 Linux MPRIS 的 Shuffle、LoopStatus 双向同步。范围与实测见 [播放模式验证](docs/validation/2026-10-27-playback-modes.md)。

界面采用云瓷白 / 曜石黑双主题 Liquid Glass 设计：悬浮侧栏、原创折射唱片、分色音乐来源卡与独立玻璃播放舱；设置中支持浅色、暗色与实时跟随系统，外观选择在本机保存；本地音乐、平台连接、歌单、账号设置、歌词和队列统一重排。歌单支持筛选、多选和下一首，独立“正在播放”页返回后保留列表上下文，舞台随窗口高度伸展、无框悬浮歌词居中并自适应字号/行距、下一首位于内容底部；侧栏按本地 / 网易云 / 酷狗归组，左下队列卡片整块可点击；播放队列、顺序、当前曲目、进度、音量和静音自动保存在本机；重启后暂停恢复，点击播放继续，在线曲目需连接原账号。网易云页面采用独立音乐空间布局：热歌前三封面舞台、真实歌单封面网格、大搜索框和我的收藏；公开/私人歌单及搜索歌单显示平台实际封面，图片按需读取，浅色和暗色均适配。网易云歌曲菜单支持喜欢、自建歌单添加/移除，公开歌单详情可收藏；整单播放会读取完整歌单后建立完整队列，收藏写入及会员兼容的真实账号验收仍待完成。公开内容无需登录即可浏览；曲目显示官方 VIP / 付费专辑 / VIP 音质标记，连接账号后同步有效会员套餐并沿用官方权限取链，完整或试听以实际响应为准。见 [网易云重设计与封面](docs/validation/2026-10-27-netease-redesign.md)、[网易云发现与搜索](docs/validation/2026-10-27-netease-discovery.md)、[液态玻璃界面验证](docs/validation/2026-10-27-liquid-glass.md)、[页面与导航验证](docs/validation/2026-10-27-listening-pages.md) 和 [歌词接入范围](docs/validation/2026-10-26-presentation.md)。

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
pnpm test:desktop
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
