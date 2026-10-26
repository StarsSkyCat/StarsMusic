# StarsMusic 产品设计与技术选型

日期：2026-10-26。状态：设计建议，供后续实现使用。

本文件记录初始设计基线。编写设计时工作区为空项目，之后已建立仓库基础、开发文档与规则；最新进度见 [开发路线图](roadmap.md)。尚未运行两个参考应用，也未使用真实账号验证第三方接口。下文“支持”如用于本项目规划，均指目标能力，不代表已经实现。

## 1. 产品定位与核心决策

StarsMusic 是一款 Linux 优先、支持多个音乐账号的桌面播放器。核心体验是：在一个窗口管理网易云、酷狗和本地音乐，使用统一播放队列，可靠响应系统媒体控制。

推荐主路线：**Electron + Vue 3 + TypeScript，mpv 作为独立音频进程，SQLite 保存本地数据，平台能力通过 Provider 适配器接入。**

初期以本地客户端为中心，平台请求由本机发出，无需用户另行部署服务器。先做账号、歌单、搜索、播放、歌词与 Linux 桌面集成，再扩展视觉效果与其他操作系统。

选择 Electron 的核心原因是多发行版 UI 运行时的一致性、现有 Node.js 音乐接口生态，以及参考项目的可借鉴经验。代价是安装体积与内存开销；不将“小于几十 MB”的体积目标作为当前承诺。

## 2. 参考项目调研

| 项目 | 已核实内容 | 对本项目的价值 |
| --- | --- | --- |
| YesPlayMusic | 默认分支 package.json 使用 Electron、Vue 2、Vuex、Howler、mpris-service；当前依赖包含 @neteaseapireborn/api。README 声明当前分支进入维护模式，另有 2.0 Alpha | 网易云扫码登录流程、音乐库组织、歌词、MPRIS 交互 |
| Mineradio-paused | README 声明长期停更；package.json 以 Windows Electron 构建为主；源码包含 kugou-api.js、酷狗官方网页登录窗口及 Cookie 会话接入 | 酷狗登录窗口、会话状态判断、播放错误分类、沉浸式交互思路 |

判断基于实际读取的 README、package.json 与登录相关源码，不能把旧客户端使用的依赖版本直接当作新项目基线。

YesPlayMusic 的扫码接口可在 [src/api/auth.js](https://github.com/qier222/YesPlayMusic/blob/master/src/api/auth.js) 查看；酷狗逻辑分别见 Mineradio 的 [desktop/main.js](https://github.com/XxHuberrr/Mineradio-paused/blob/main/desktop/main.js)、[kugou-api.js](https://github.com/XxHuberrr/Mineradio-paused/blob/main/kugou-api.js) 与 [server.js](https://github.com/XxHuberrr/Mineradio-paused/blob/main/server.js)。

源码复用边界：YesPlayMusic 的许可证文件、README 附加说明需一并记录；Mineradio 的 package.json 标注 GPL-3.0-only，README 另有品牌与原创视觉声明。当前方案采取独立实现、参考流程的方式。需要复制代码或资产时，再按对应文件与依赖的实际许可确定发布要求，本阶段不替整个新项目确定许可证。

## 3. 用户与首版范围

主要面向 Ubuntu / Debian、Fedora、Arch 等 Linux 桌面用户，包括 GNOME、KDE Plasma 与常见 Wayland 合成器用户。

### 首版必须完成

- 游客可进入应用；本地音乐功能不依赖在线账号。
- 网易云、酷狗分别登录，可同时保持各一个账号的会话。
- 展示账号信息、读取用户歌单、打开歌单、分页加载曲目。
- 平台内搜索；聚合搜索并行请求，结果标明来源与独立失败状态。
- 统一队列：播放、暂停、上一首、下一首、定位、音量、顺序、随机与单曲循环。
- 播放当前账号和接口实际允许播放的曲目，显示实际获得的音质及限制原因。
- 行级歌词；逐字歌词在上游有数据时作为增强能力。
- 本地文件选择、目录导入与基础标签读取，初期覆盖 MP3 / FLAC / AAC / Ogg / WAV 测试样本。
- 最近播放、队列恢复、主题切换、账号退出。
- Linux MPRIS、媒体键、通知、托盘可用时的后台控制。
- x86_64 的 AppImage、DEB、RPM 发布验证。

云端收藏写入、歌单编辑、批量下载、跨平台歌单迁移、均衡器、交叉淡入淡出、真正无缝衔接、桌面歌词、3D 场景、MV、云盘上传放在后续阶段。首版允许用户从队列返回源歌单，云端数据以各平台为准。

## 4. 界面与交互设计

### 4.1 设计方向

清晰的音乐库和安静的播放页。默认跟随系统明暗主题，以深色方案作为视觉设计起点；中性石墨背景、低饱和紫蓝强调色、专辑封面提供内容色彩。StarsMusic 使用自身品牌；网易云与酷狗以来源标识和文字区分。

建议令牌：背景 #15161C、面板 #20222B、正文 #F4F5F7、次要文字 #ABB0BE、强调色 #A99BFF。浅色模式另设完整语义变量。颜色最终通过真实组件对比度检查调整，状态不只靠颜色表达。

正文建议 14–15 px，页面标题 24–28 px，列表行高 48–56 px，常用按钮热区至少 36 px；可选择宽松密度。使用系统字体与中文回退。焦点可见、所有主要流程可用键盘操作，并响应减少动态效果偏好。

### 4.2 信息架构

| 区域 | 内容 |
| --- | --- |
| 左侧导航 | 继续听、搜索、我的音乐、本地音乐、网易云、酷狗、设置 |
| 顶部 | 前进后退、当前页面、搜索入口、双平台账号状态 |
| 主内容 | 最近播放、歌单、专辑与曲目列表；平台页面展示该平台独立内容 |
| 底部固定播放栏 | 封面与来源、曲目信息、播放控制、进度、音量、歌词与队列入口 |
| 右侧抽屉 | 当前队列，可移除、清空、调整顺序 |
| 独立播放页 | 大封面、歌词、来源、实际音质；简洁背景，支持返回浏览页 |

默认窗口建议 1280 × 800，最小布局目标 960 × 640；侧栏约 216 px，底栏约 88 px。窄窗口收起次要导航与列表列，队列以覆盖抽屉显示，不把歌词和表格挤在一起。

```text
┌──────────────┬─────────────────────────────────────────────────┐
│ StarsMusic   │  ‹  ›   搜索歌曲、歌手、歌单      网易云 · 酷狗  │
│              ├─────────────────────────────────────────────────┤
│ 继续听       │  下午好                                         │
│ 搜索         │  继续播放             最近打开的歌单             │
│ 我的音乐     │                                                 │
│ 本地音乐     │  [封面]  [封面]  [封面]  [封面]                 │
│              │                                                 │
│ 网易云       │  我的歌单                       [全部来源 ▾]    │
│ 酷狗         │  名称                 来源       曲目数         │
│              │  通勤                 网易云     128            │
│ 设置         │  深夜                 酷狗       56             │
├──────────────┴─────────────────────────────────────────────────┤
│ 封面 曲名 / 歌手 · 来源     ⏮  ▶  ⏭     进度   音量 歌词 队列 │
└────────────────────────────────────────────────────────────────┘
```

这是布局草案，不是已经交付的高保真原型。

### 4.3 关键流程

首次启动直接显示空音乐库，提供“连接网易云”“连接酷狗”“导入本地音乐”。登录只在相关操作需要账号时触发。账号面板分别显示两个平台的头像、昵称、验证状态和退出按钮。

聚合搜索按来源保留曲目；同名歌曲不自动合并。可用歌手、时长、专辑及版本信息提供“其他平台版本”，由用户选择，避免 Live、翻唱、重制版替换原版。

无法播放的行仍可查看详情，并明确显示“登录已过期”“需要会员或购买”“仅可试听”“地区限制”“官方客户端限定”或“服务暂时不可用”。只有接口明确给出原因时才使用确定文案，无法确认时显示通用错误并提供重试。

账号头像出现只代表身份验证成功；可播放能力在实际曲目解析时判断。试播放必须显示试听标记与实际时长。

关闭窗口默认为保留后台播放，首次操作解释退出入口；没有可用托盘的桌面环境必须提供明确的退出菜单和窗口关闭偏好，不能依赖隐藏的托盘图标找回应用。

## 5. 技术方案比较

以下比较为针对本项目的工程判断，不是性能基准测试。

| 路线 | 优势 | 本项目的成本 | 决策 |
| --- | --- | --- | --- |
| Electron + Vue 3 / TS | 内置 Chromium；Node.js 接口可复用；网页授权与桌面 UI 容易协同 | 包体、内存与运行时安全更新成本 | 主选 |
| Tauri 2 + Vue 3 / Rust | 可减少框架运行时打包负担；Rust 原生能力 | Linux 使用 WebKitGTK；发行版 WebView 差异；现有 Node 接口需额外进程或重写 | 保留备选 |
| Qt 6 / QML + C++ 或 Rust | 原生桌面、音频与系统集成能力强 | 网页登录、接口生态与自定义界面的开发投入更高 | 当前不选 |
| Flutter | 自绘 UI 与多平台布局 | 现有音乐接口、网页登录与 Linux 桌面桥接需更多验证 | 当前不选 |

Electron 内置 Chromium / Node.js，Tauri 使用系统 WebView，这分别见 [Electron 官方介绍](https://www.electronjs.org/docs/latest/) 与 [Tauri WebView 说明](https://v2.tauri.app/reference/webview-versions/)。因此这里优先为 UI 运行环境的一致性付出体积成本；Linux 系统库、驱动与桌面差异仍需验证。

### 5.1 推荐技术栈

| 层 | 选择 | 说明 |
| --- | --- | --- |
| 桌面容器 | Electron 官方仍支持的稳定版本 | 建项时锁定已验证版本；持续跟随安全更新，不能照搬参考项目旧版本 |
| UI | Vue 3 + TypeScript + Vue Router | Composition API；视图与平台数据结构分离 |
| 状态 | Pinia | 保存 UI 状态和播放器状态投影；播放真值由后台服务维护 |
| 开发构建 | Vite / electron-vite + pnpm | 主进程、preload、renderer 独立构建，锁文件固定依赖 |
| 样式 | CSS 语义变量 + scoped CSS | 自建播放器基础组件，保持视觉一致性 |
| IPC | contextBridge + 类型化命令 + 运行时校验 | 每个功能独立白名单方法；可选 Zod 实现参数校验 |
| 接口 | Node.js Provider 进程 | 直接调用经过验证的接口模块，默认不启动公开 HTTP API 服务 |
| 播放 | mpv 子进程 + JSON IPC | 独立解码与音频输出，避免将所有格式依赖于 WebView |
| 数据 | SQLite + better-sqlite3 | 在独立数据进程执行；需为 Electron ABI 与目标架构构建原生模块 |
| 凭据 | Electron safeStorage 异步接口与系统密钥服务 | 封装为 CredentialVault；必须验证真实安全后端，不能仅检查 API 可用 |
| 本地标签 | music-metadata | 在后台扫描，限制并发，缓存结果 |
| Linux 系统控制 | MPRIS / D-Bus 适配层 | 库选型以兼容性验证为准，不让第三方库类型进入业务模型 |
| 分发 | electron-builder；后续独立 Flatpak 清单 | AppImage / DEB / RPM；各渠道独立验证和更新策略 |
| 验证 | Vitest + Playwright Electron + 实机矩阵 | 关键状态、接口契约、桌面冒烟；Playwright Electron 当前标为实验性 |

Vue 官方推荐 Vite 工具链、Pinia 状态管理，见 [工具链](https://vuejs.org/guide/scaling-up/tooling) 和 [状态管理](https://vuejs.org/guide/scaling-up/state-management.html)。桌面构建参考 [electron-vite](https://electron-vite.org/guide/)，自动化能力边界参考 [Playwright Electron](https://playwright.dev/docs/api/class-electron)。

## 6. 进程与模块架构

```mermaid
flowchart TB
    UI[Vue 界面：浏览 / 搜索 / 歌词 / 队列]
    Bridge[Preload：受限的类型化 API]
    Main[Electron 主进程：窗口 / IPC 校验 / 服务协调]
    Core[播放与队列服务：唯一状态源]
    N[网易云 Provider 进程]
    K[酷狗 Provider 进程]
    MPV[mpv 音频进程]
    DB[数据进程：SQLite / 标签扫描]
    Vault[CredentialVault：系统保护的凭据]
    OS[DesktopIntegration：Linux MPRIS / 通知 / 托盘]
    Login[隔离的官方授权窗口]
    UI --> Bridge --> Main
    Main --> Core
    Core --> N
    Core --> K
    Core --> MPV
    Main --> DB
    Main --> Vault
    Main --> Login
    Main --> OS
```

主进程只做轻量协调。平台调用以 Electron utilityProcess 承载；登录窗口由主进程管理，登录结果经凭据服务送给对应 Provider。Provider 进程崩溃可单独重启，但它拥有网络和部分凭据访问权，并不自动成为安全沙箱。

播放/队列服务维护唯一队列和状态。UI、歌词与 MPRIS 订阅同一事件流，避免三者各自计时、各自切歌。UI 重载时重新订阅并读取快照；整个应用退出时结束音频进程。

### 6.1 统一实体与接口

```ts
type ProviderId = 'netease' | 'kugou' | 'local';

interface TrackRef {
  provider: ProviderId;
  id: string;                  // 保留平台原始标识，避免大整数精度丢失
  variant?: string;            // 版本或资源变体
}

interface ProviderContext {
  accountId?: string;
  clientChannel?: string;      // 如 kugou-web / kugou-app，不允许混用
}

interface MusicProvider {
  capabilities(ctx: ProviderContext): Promise<ProviderCapabilities>;
  beginLogin(method: LoginMethod): Promise<LoginChallenge>;
  pollLogin(challengeId: string): Promise<LoginState>;
  cancelLogin(challengeId: string): Promise<void>;
  getSession(ctx: ProviderContext): Promise<SessionStatus>;
  logout(ctx: ProviderContext): Promise<void>;
  search(query: SearchQuery, ctx: ProviderContext): Promise<TrackPage>;
  getPlaylists(cursor: string | undefined, ctx: ProviderContext): Promise<PlaylistPage>;
  getPlaylistTracks(id: string, cursor: string | undefined,
    ctx: ProviderContext): Promise<TrackPage>;
  resolveStream(track: TrackRef, quality: QualityPreference,
    ctx: ProviderContext): Promise<StreamResolution>;
  getLyrics(track: TrackRef, ctx: ProviderContext): Promise<LyricsResult>;
}
```

以上是设计契约片段，省略的数据类型在实现阶段补齐；不作为现有可编译源码。所有接口经过同一请求取消、超时、限流和错误归一化机制。官方窗口登录也映射成登录 Challenge，由窗口事件更新状态，不要求它通过二维码轮询完成。

Track 元数据包含歌名、歌手、专辑、时长、封面、来源、版本标签、可播放状态。酷狗 hash、albumAudioId 等扩展字段保留在该 Provider 的资源描述中，不强行用一个公共 ID 替代全部播放参数。

缓存按 provider + accountId + clientChannel 分区。网络请求带会话 generation；退出或切换账号后，旧请求完成也不得写回缓存或替换当前会话。所有平台数据都有取回时间与过期策略。

能力声明按渠道和账号返回 search、playlists、lyrics、availableQualities 等；UI 据此展示功能。“有会员”不能直接推出所有曲目可用所有音质。

## 7. 登录与平台接入

### 7.1 网易云

首选 App 扫码：获取 key → 生成二维码 → 有间隔轮询 → 用户确认 → 后台保存 Cookie → 查询账号 → 拉取歌单 → 解析并实际播放测试曲目。

YesPlayMusic 的认证封装说明了 800 / 801 / 802 / 803 的二维码状态。内部映射成统一状态，不向 UI 泄漏平台状态码；接口当前行为须以固定版本真实验证为准。

API 候选优先验证 [NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)，并与 YesPlayMusic 当前使用的 @neteaseapireborn/api 比较登录与播放兼容性。最终选通过 P0 契约验证的固定版本；不同时常驻两套实现。只暴露所需接口，不启用音源解锁与跨源替换功能。

首版不收集账号密码。短信登录在扫码无法满足需求且接口验证可用后补充。需要官方安全验证时，提供隔离的官方页面入口。

### 7.2 酷狗

**初步主方案：独立官方网页登录窗口。** 参考 Mineradio 在 Electron 独立 session 中打开酷狗官方页面、在主进程提取必要会话并验证播放凭据的流程，重新实现账号隔离、加密持久化与错误处理。

**候选方案：酷狗 App 扫码。** [MakcRe/KuGouMusicApi 文档](https://github.com/MakcRe/KuGouMusicApi/blob/main/docs/README.md) 包含 /login/qr/key、/login/qr/create、/login/qr/check；成功状态返回 Token。该文档明确不同客户端版本的 Token 不通用。因此网页登录态与 App 登录态必须绑定各自请求渠道，不把 Cookie 导入后直接假定可调用全部 App 接口。

P0 分别验证官方网页登录和 App 扫码的“登录 → 账号 → 用户歌单 → 播放”闭环，选择覆盖目标功能且可重复成功的渠道作为首版默认。候选渠道若只能登录但不能读取歌单或播放，不能据此宣布接入完成。

若需两个渠道并存，它们共享 UI 抽象，但会话、设备标识、缓存与能力独立。首版优先避免要求用户为同一平台登录两次。网页登录仅得到用户身份、未得到有效播放凭据时，显示“登录未完成”，允许重试或换登录方式。

### 7.3 共同会话规则

- 登录状态：未登录 → 等待扫码/网页授权 → 待确认 → 正在验证 → 已连接；另含已过期、已取消与失败。
- 同一账号只保留一个活动 Challenge；关闭弹窗、二维码过期或切换平台时取消旧轮询。按上游允许的频率轮询，网络错误退避，不反复自动重新登录。
- SessionStatus 分别记录身份是否已验证、凭据渠道、过期时间/最近验证时间；每首曲目的可播放性以 resolveStream 为准。
- Cookie / Token 仅在主进程凭据服务和对应 Provider 内流转，不进入 Pinia、URL 查询参数、页面 localStorage、错误日志或遥测。
- 官方页面使用无 Node 权限、无业务 preload 的独立窗口；允许的跳转域名按实际授权链列举并验证，不能任意打开页面后提取凭据。
- 网页授权窗口优先用内存 session；成功后仅提取所需凭据并交给 Vault。若官方流程必须保留持久 session，须单独验证 Electron Cookie 存储保护与退出清理，不能让它成为绕过 Vault 的明文副本。
- 密钥服务缺失、锁定或仅有弱后端时，进入临时会话模式；不静默降级为明文或使用硬编码密钥长期保存。恢复密钥服务后再提供“记住登录”。
- 退出立即使会话 generation 失效、取消请求、停止相应在线播放、清除凭据与授权窗口会话。保留本地文件、设置与本地历史；清理该账号私有歌单缓存，避免继续显示已退出账号的个人库。

safeStorage 在 Linux 的安全语义取决于密钥后端，旧接口的 basic_text 并不提供有效保护；新异步接口也需要检查所选版本的实际后端行为。见 [官方 safeStorage 文档](https://www.electronjs.org/docs/latest/api/safe-storage)。

## 8. 播放引擎与数据流

### 8.1 为什么使用 mpv

mpv 提供本地与网络媒体播放、格式解码、音频输出和 JSON IPC。将其作为独立子进程，可让播放器生命周期与 UI 重绘分离。其 IPC 在 Linux 使用本地 socket，Windows 使用命名管道，见 [mpv 手册](https://mpv.io/manual/stable/)。

相应成本是额外进程、二进制/依赖打包和发布检查。HTMLAudio / Howler 作为简化备选；如果 mpv 在目标包中的兼容性或分发投入超出预算，应通过 P0 对比后明确切换，不在运行时静默更换内核导致状态分叉。首版不直接绑定 libmpv 原生插件，以减少 Electron ABI 耦合。

mpv 的 PCM 不会自动进入浏览器 Web Audio，因此首版不承诺实时频谱、节奏粒子或音频驱动 3D 效果；后续需单独设计音频分析通道。逐行歌词仅依赖播放时间事件。

### 8.2 完整播放链

1. 用户选择 TrackRef，播放服务生成新的 playbackGeneration。
2. Provider 检查当前会话及渠道，返回短时播放 URL、必要请求头、实际音质、过期时间和试听信息，或归一化限制原因。
3. 主进程验证结果，在私有 IPC 通道为 mpv 设置当前媒体请求参数，再加载曲目。请求头不能通过进程命令行暴露，跨曲目/平台切换时必须清除旧凭据。
4. mpv 的 ready、position、pause、buffering、end-file、error 事件驱动唯一播放状态，附带当前 generation；过期解析与旧曲目事件不能覆盖新曲目。
5. UI、歌词和 MPRIS 接收快照与增量事件。进度事件节流，UI 可基于单调时钟插值；拖动、暂停与缓冲后按内核事件校准。
6. 失败区分鉴权、链接过期、网络和格式错误。链接过期最多重新解析一次并尝试恢复位置；权限错误引导处理，不无限切歌或登录重试。
7. 预取下一首的元数据，接近切歌时再解析短时 URL；不把 URL 当永久歌曲地址写入数据库。

底层进程只接受服务生成的播放指令。使用参数数组启动，不拼接 shell；禁用用户配置、外部脚本、视频窗口与不必要协议。socket 使用私有目录和限制权限；崩溃时清理句柄，按上限重启，不自动重复播放造成双声道实例。

带凭据的 CDN 请求须验证允许的主机及重定向，不把平台 Cookie 无差别发送给媒体域名。若 mpv 对请求头隔离或重定向无法提供所需保证，才增加本机媒体网关：仅绑定 loopback、随机端口、不可猜令牌、Range 支持和严格目标校验；该条件必须在 P0 验证。

测试音质以实际 codec / bitrate / sample rate 为准；“无损”只在平台明确返回相应资源时显示。首版不承诺位完美输出，也不承诺独占设备或系统混音器绕过。

### 8.3 本地数据

SQLite 保存 accounts_public、tracks、playlists、playlist_items、queue_items、play_history、local_files、settings、schema_migrations；私密凭据只存 Vault 保护后的密文或引用。

queue_items 有独立 entryId，允许同一歌曲在队列中出现多次。平台曲目主键为复合标识；本地文件以稳定内部 ID 关联路径与文件信息，移动、删除和重扫后更新状态。

公开元数据与账号私有元数据分开标识，清晰记录来源与归属。写入使用事务；扫描和分页响应可取消；迁移前备份数据库，版本回退时不得直接读取不兼容结构。

配置、数据、缓存依循 XDG 对应目录；在 Electron ready 前统一配置路径，考虑 Flatpak 映射。诊断日志保留有限天数并轮转。封面、歌词等缓存有配额和过期规则，音频长期离线缓存及下载另行设计。

## 9. Linux 优先的兼容性与分发

“覆盖各发行版”通过明确的运行时基线、分发渠道和测试矩阵推进，不能等同于每个发行版、架构、旧系统都保证运行。

### 9.1 初期验证矩阵

| 组别 | 系统 / 桌面 | 级别 |
| --- | --- | --- |
| 基线 | Ubuntu 22.04 / 24.04 LTS，GNOME，X11 与 Wayland | 首版必须验证；22.04 取决于所选 Electron 仍可运行 |
| Debian 系 | Debian 12 / 13，至少 GNOME 或 KDE 各一种实际环境 | 首版验证 |
| RPM 系 | 发布时仍受支持的 Fedora 版本，GNOME Wayland；补测 KDE | 首版验证 |
| 滚动发行 | Arch / EndeavourOS，KDE Plasma Wayland | 首版验证 |
| 其他桌面 | Mint Cinnamon / Xfce、openSUSE、Hyprland 等 | 按需求补测，不以打包成功替代运行验证 |
| 国产发行 | 用户实际使用的 Deepin / UOS / openKylin 具体版本 | 收集准确版本和架构后加入矩阵 |

初期优先 x86_64 / glibc。ARM64 在音频包、原生 SQLite 模块与真实设备通过后增加。musl / Alpine、32 位、LoongArch 不列入首版支持承诺。

### 9.2 系统集成

- MPRIS：公开播放状态、元数据、封面、音量、位置、播放/暂停/切歌/定位。遵循单位与 Seeked 等信号要求；服务异常不影响音频核心。规范见 [MPRIS 2.2](https://specifications.freedesktop.org/mpris/latest/)。
- 媒体键优先通过桌面媒体控制与 MPRIS，避免同时全局注册造成重复响应。
- 自定义全局快捷键通过 Electron / portal 能力实现。Wayland 依合成器和 portal 后端决定可用性；注册失败时保留窗口内快捷键并显示配置状态。见 [Electron globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut)。
- 桌面歌词安排在后续；Wayland 不保证任意定位、穿透和永久置顶，功能按环境声明能力。
- 托盘、通知、文件选择、桌面入口与 MIME 关联单独验证；托盘缺失不阻碍退出及恢复窗口。
- 验证 PipeWire 环境及 PulseAudio 路径，补测蓝牙切换、耳机拔插、音频服务重启与休眠唤醒；具体行为取决于分发的 mpv 构建。
- 默认遵守 Electron 沙箱要求，不把 --no-sandbox 当作用户常规启动方式。

### 9.3 打包与更新

首版 AppImage 用于便携试用，DEB / RPM 用于常见原生安装。后续增加 Flatpak 作为受控运行时渠道，AUR 可提供构建与安装入口。目标格式参考 [electron-builder 文档](https://www.electron.build/v26/docs/targets/)。

DEB / RPM 声明与验证系统 mpv 依赖；AppImage 和 Flatpak 使用可追溯、经验证的 mpv 及其依赖构建。开发模式允许使用已安装的系统 mpv，但必须报告版本与能力，避免开发机成功掩盖分发缺依赖。

使用支持矩阵内最老的兼容构建基线，而不是在最新开发机打包后假定 glibc 可向后兼容。AppImage 额外验证 FUSE 与解包运行路径；Flatpak 单独检查文件 portal、网络、音频、密钥服务与最小 D-Bus 权限。

首版统一提供版本提示和对应渠道安装说明。DEB / RPM / Flatpak 后续交由包管理渠道更新；AppImage 自动替换仅在签名、回滚和权限验证完成后加入。下载校验与可验证签名分别处理，单独的 SHA256 不代替来源认证。发行记录包含 mpv / FFmpeg 的构建配置、许可文件与适用的源码获取方式。

Electron 的官方维护范围是最近三个稳定大版本，见 [版本支持政策](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)。发布计划须包含运行时更新与回归预算。

## 10. 代码结构建议

```text
StarsMusic/
  src/
    main/                  # 窗口、IPC 入口、生命周期、凭据服务
    preload/               # contextBridge 白名单
    renderer/              # Vue 页面、组件、样式、Pinia 投影
  packages/
    contracts/             # 领域实体、IPC schema、错误码
    playback/              # 队列、状态机、歌词时间轴、mpv 控制
    providers/
      netease/
      kugou/
      local/
    storage/               # SQLite、迁移、缓存、扫描
    desktop/
      linux/               # MPRIS、portal、桌面特性
      windows/             # 后续平台接口
      macos/               # 后续平台接口
  resources/               # 图标、经过校验的外部二进制及清单
  packaging/               # Linux 各格式清单、依赖与构建脚本
  tests/                   # 契约、状态机、端到端、发行包验证
  docs/
```

采用一个 pnpm 工作区即可；初期可用目录边界实现模块化，不引入独立服务器、微服务和远程插件市场。远程平台代码升级通过正式应用发布，避免任意下载并执行适配器代码。

## 11. 实施顺序与验收

### P0：验证最难的闭环

首先做最小桌面验证程序及固定版本的接口适配实验。不开完整产品 UI，先排除账号与分发的关键风险。

| 验证项 | 通过条件 |
| --- | --- |
| 网易云 | 真实账号扫码；读取账号和用户歌单；已授权曲目可解析并完整播放；重启恢复或正确要求重新授权 |
| 酷狗网页登录 / App 扫码 | 分渠道验证身份、歌单与播放；记录 Token 来源和适用接口，选定默认渠道 |
| 权限限制 | 免费曲目、账号有权曲目、试听/不可用曲目分别记录实际结果，不将 VIP 身份当作保证 |
| 会话 | 退出清理、二维码过期、取消、断网、旧请求回写、密钥服务缺失/锁定均有确定行为 |
| mpv | 本地与在线音频、必要请求头、定位、切歌、凭据重置、重定向、故障恢复均可重复通过 |
| Linux 包 | 至少 Ubuntu GNOME 与 Fedora / Arch KDE 各一真实会话；AppImage 与原生包运行；MPRIS 和音频可用 |

账号验证需要使用用户自行授权的测试账号；不把真实凭据保存到仓库或 CI。P0 在账号授权条件具备后执行。本设计阶段没有请求账号凭据，也没有宣称上述项目已通过。

退出门槛：两个平台至少各有一条可重复的“登录—歌单—实际播放”路径，并产出可运行 Linux 验证包。若某个平台无法闭环，先记录受限能力和替代方案，不能用模拟成功界面标记完成。

### P1：Linux 可用首版

按第 3 节完成账号中心、音乐库、搜索、队列、歌词、本地音乐与系统集成；实现数据库迁移和异常恢复，发布 x86_64 测试包。

### P2：Linux 稳定与增强

扩展矩阵、Flatpak、ARM64、云端收藏和歌单编辑；根据实测加入无缝衔接、均衡器、逐字歌词与兼容桌面上的歌词窗口。

### P3：Windows 与 macOS

沿用 Provider、领域模型、队列与 UI，通过 DesktopIntegration / AudioEngine / CredentialVault 替换或扩展系统实现。增加安装包、媒体会话、通知、mpv 分发、签名与 macOS 公证验证；架构可复用不意味着只改构建目标即可发布。

### 性能目标与测试方法

以下为待实测的初始预算：在 4 核 CPU、8 GB 内存、SSD 的 Linux x86_64 参考机上，主界面冷启动目标 3 秒内；本地播放首声目标 1 秒内；在线播放在固定网络样本下以 P95 3 秒为优化目标，另记上游等待时间。后台稳定播放时总进程内存以 500 MiB 内作为初始优化预算，不能只测 renderer。

曲目列表使用虚拟列表；1 万条本地元数据检索和分页期间界面可交互。参考机、发行版、图形会话、mpv / Electron 版本、网络条件与数据集随结果记录；预算不作为未经测量的宣传指标。

必要验证聚焦：Provider 响应契约和错误分类；登录取消/过期；队列与随机历史；快速连续切歌；旧事件丢弃；音频进程崩溃；会话隔离；数据库迁移。CI 使用脱敏固定响应，不自动登录真实账号；真实平台与 Wayland / MPRIS / 音频设备在发布矩阵人工验证。

## 12. 当前结论与待验证事项

技术主路线采用 Electron + Vue 3 + TypeScript + mpv + SQLite。产品保持双平台账号独立、浏览和播放体验统一；Linux 桌面集成是首版能力。

实施前的关键不确定项已经集中到 P0：网易云具体 API 分支、酷狗有效凭据渠道、mpv 请求参数及分发、密钥服务可用性、Linux 包的运行基线。它们需要真实账号和真实桌面验证，不能只靠参考仓库的 README 确认。

本阶段交付设计文档，不创建正式产品代码、安装包、远程服务或任何平台账号会话。
