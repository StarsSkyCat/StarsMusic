# StarsMusic

Linux 优先的跨平台桌面音乐播放器，计划接入网易云音乐、酷狗音乐与本地音乐。

当前处于 P0 接入阶段：支持本地音频、网易云扫码登录、分类公开歌单、歌曲/歌单搜索与播放，并已实现酷狗标准版 App 扫码、账号验证、歌单分页、曲目列表、流解析和单曲播放。网易云真实闭环已由用户确认出声；酷狗真实登录、私人歌单、曲目列表和部分歌曲出声已确认，取链已改为只按主 hash 解析以修复名称/声音错配，部分曲目仍因平台权限/资源限制不可用。已实现二维码区域按平台选择的 SQLite 加密“记住登录”（退出即删），使用应用管理的本地随机密钥，不依赖系统密钥服务；真实账号跨重启仍待用户验收。目录扫描与持久音乐库尚未实现；已提供本机 Arch 原生验证包，其他发行格式仍待实现。具体范围见 [网易云说明](docs/netease.md)、[酷狗说明](docs/kugou.md)、[凭据持久化](docs/credentials.md) 与 [验证记录](docs/validation/2026-10-26-netease.md)。

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

主窗口右上角提供最小化、最大化/还原和关闭按钮；顶部空白区域可拖动，滚动页面时控制保持可见。窗口控制经独立白名单桥接，Linux/Windows 共用控制，macOS 配置保留原生红黄绿按钮；Windows/macOS 尚未实机验证。关闭遵循现有托盘设置，见 [窗口控制验证](docs/validation/2026-10-28-window-controls.md)。

底栏通过一个按钮依次切换列表循环 / 随机播放 / 单曲循环，图标和提示显示当前模式；模式随队列保存，并与 Linux MPRIS 的 Shuffle、LoopStatus 双向同步。范围与实测见 [播放模式验证](docs/validation/2026-10-27-playback-modes.md)。

酷狗空间支持发现歌单、歌曲/歌单搜索、公开详情分页、我的歌单及真实封面，公开内容可匿名浏览；连接标准版 App 账号后可尝试单曲/整单播放和多选下一首。匿名接口及桌面已实测，已补充歌曲 VIP / VIP 音质标记及登录会员套餐同步；真实账号搜索播放/整单与会员权限矩阵、收藏和歌单编辑仍待验证或实现，见 [酷狗搜索接入](docs/validation/2026-10-27-kugou-discovery.md)。

界面采用重新设计的浅色 / 暗色双主题：中性内容底色、红色主操作、悬浮玻璃侧栏与播放条。音乐库使用已有原创山景和紧凑来源入口，双平台页面使用统一分段导航、搜索、真实封面网格与曲目表；账号设置使用分组实底表面，队列和菜单使用高遮蔽度玻璃浮层。独立播放页保持封面、居中歌词与下一首布局；所有页面共享字号、圆角、焦点与禁用状态，并支持减少动态效果及减少透明度偏好。外观选择仍在本机保存并可跟随系统；这是 Electron/CSS 的材质实现，未调用 Apple 原生 Liquid Glass。最新范围和检查见 [全界面重设计验证](docs/validation/2026-10-28-interface-redesign.md)。

歌单支持筛选、多选和下一首；往返独立播放页保留列表上下文。队列、顺序、当前曲目、进度、音量和静音自动保存在本机；重启后暂停恢复，在线曲目需要连接原账号。网易云支持喜欢、自建歌单添加/移除和公开歌单收藏，整单播放读取完整歌单后建立队列；真实账号写入和完整会员权限矩阵仍待验收。公开内容可匿名浏览，平台封面由后台按需读取，收费/音质和完整播放/试听以实际响应为准。详见 [网易云说明](docs/netease.md)、[酷狗说明](docs/kugou.md) 和 [歌词接入范围](docs/validation/2026-10-26-presentation.md)。

两边搜索栏共用组件，焦点仅高亮外层，支持一键清空；平台页右上角显示当前昵称。酷狗权益区在音乐空间与账号设置中展示已确认套餐/到期日、同步失败与重试，见 [搜索与权益验证](docs/validation/2026-10-27-platform-search-rights.md)。

音乐库顶部支持网易云 / 酷狗在线歌曲和歌单搜索，并匹配已加载本地音频与已同步私人歌单；来源独立分页、失败和重试。首页已移除重复的当前播放队列列表，队列保留在抽屉；酷狗“我喜欢”统一按官方最新收藏在前的顺序分页和整单播放。见 [音乐库搜索与顺序验证](docs/validation/2026-10-27-library-search-order.md)。

## 启动与检查

需要 Node.js 24.x、pnpm 10.34.9；本地播放需要 Linux 与 PATH 中可运行的系统 mpv（本机验证 0.41.0）：

```bash
pnpm install --frozen-lockfile
pnpm setup:electron
pnpm dev
```

本机 Arch 打包与安装验证见 [打包说明](packaging/README.md)、[首次安装记录](docs/validation/2026-10-27-arch-package.md) 和 [界面更新后的安装记录](docs/validation/2026-10-28-local-install.md)。

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
- packaging/：Linux 桌面入口、图标与 Arch 原生包配置。
- scripts/：仓库工具。
- docs/：设计、开发、验证与决策记录。

项目许可证尚未确定，发布前补充 LICENSE 与完整的第三方许可清单；当前直接依赖见 [依赖记录](docs/dependencies.md)。
网易云协议基线的来源与许可见 [第三方声明](THIRD_PARTY_NOTICES.md)。

本地播放的边界与实际验证范围见 [播放说明](docs/playback.md) 和 [P0 记录](docs/validation/2026-10-26-local-playback.md)。
