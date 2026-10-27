# 开发指南

## 当前能运行什么

已实现安全窗口、本地播放、网易云 App 扫码/私人歌单/热歌榜/分类公开歌单/歌曲与歌单搜索/播放，酷狗标准版 App 扫码、设备注册、账号验证、歌单/曲目分页、流解析和单曲播放，以及可选的 SQLite 加密“记住登录”。preload 暴露 getAppInfo、appearance、playback、netease、kugou、presentation、credentials 的具体白名单方法；网易云已增加整单播放、喜欢、自建歌单编辑、公开歌单收藏，以及官方会员套餐同步与单曲收费/取链权限标记，收藏写入及会员响应兼容的真实账号矩阵仍待验收；真实会员账号矩阵仍待验收；真实账号跨重启恢复、目录扫描、音乐库数据库、MPRIS 和安装包尚未验证或实现。

领域契约见 [公共契约](contracts.md)，播放基础见 [播放说明](playback.md)，独立后台进程与临时扫码流程见 [网易云说明](netease.md) 和 [酷狗说明](kugou.md)，登录保存见 [凭据持久化](credentials.md)。默认关闭“记住登录”时，应用关闭后不保留网易云或酷狗登录，需要重新扫码。

架构背景见 [设计方案](design-and-architecture.md)，任务顺序见 [路线图](roadmap.md)。

## 环境

- Linux x86_64 / glibc 为首要开发目标，其他平台后续验证。
- Node.js 24.x；.node-version 记录初始化时实际使用的 24.22.1。
- pnpm 10.34.9，以根 package.json 的 packageManager 为准。
- Git；音频播放需要 Linux 和系统 mpv，本机实际验证 0.41.0。开发时使用系统包管理器提供的版本，不通过应用自动安装系统软件。文档、类型检查、单元测试及构建不依赖 mpv。

已安装 pnpm 时，在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm setup:electron
pnpm dev
```

日常验证：

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm test:playback
pnpm build
pnpm start
pnpm test:e2e
```

- setup:electron 执行已审查的 Electron 45 install-electron 工具，下载固定运行时并按包内校验值验证；首次安装后执行，无需放开依赖生命周期脚本。
- dev 启动 Vite 与桌面窗口；开发服务只绑定 127.0.0.1:5173，端口占用时失败，不自动换端口。退出用窗口关闭或终端 Ctrl+C。
- typecheck 分别检查主进程/preload/测试与 Vue 页面，均为严格模式。
- test 使用 Node 内置测试器验证 IPC、领域契约、会话竞态和两个平台的白名单投影；不依赖图形会话。
- probe:netease 显式联网探测匿名二维码 key 端点，只报告结果，不输出 key 或二维码；不在 CI 运行，也不替代用户扫码验证。
- probe:netease-discovery 显式匿名联网检查热歌分页、公开歌单/详情及歌曲/歌单搜索，只输出归一化计数，不登录、不写凭据，CI 不运行。
- probe:kugou 显式联网验证酷狗设备注册与匿名扫码挑战，只报告固定基线和通过状态，不输出设备标识、key、二维码或响应原文；不登录账号。
- test:playback 使用实际 mpv 与合成 WAV，显式指定 null 输出，验证本地/本机网关音频、试听上限、切歌、错误与清理；不调用平台、不需要账号。需要 Linux 与 mpv，缺失时失败。
- build 编译 main、单文件 CommonJS preload 与 renderer 到 out/，不执行类型检查、不生成安装包。
- start 运行上次构建产物；test:e2e 先构建，再启动 Electron 和实际 mpv，检查 IPC、安全边界、两个平台的匿名后台状态、本地选择、默认系统音频输出和退出，需 Linux、图形会话、mpv 和可用音频服务。原生选择器在测试中被替换为合成音频路径，播放本身不模拟。

当前 Linux 关闭窗口即退出；尚未实现托盘和后台播放。macOS 保留激活重建窗口的生命周期分支，尚未实机验证。当前界面使用云瓷白 / 曜石黑 Liquid Glass 设计，包含悬浮侧栏、折射唱片主视觉、来源卡、平台扫码步骤、歌单详情、列表筛选、多选下一首、玻璃队列抽屉和独立播放页；底部播放舱持续可用。布局和视觉检查见 [液态玻璃记录](validation/2026-10-27-liquid-glass.md)，导航规则见 [页面记录](validation/2026-10-27-listening-pages.md)。网易云发现页新增真实封面、前三名舞台与搜索空间，见 [重设计与封面验证](validation/2026-10-27-netease-redesign.md)。当前在线歌曲支持行级歌词与专辑封面，范围见 [歌词与封面记录](validation/2026-10-26-presentation.md)。播放页歌词采用无框悬浮布局，居中显示并按区域大小放大字号/行距，远处歌词淡出；本地音乐归入来源分组第一项，左下队列卡整块可点击，见 [交互调整](validation/2026-10-27-floating-lyrics.md)。歌词区随窗口高度伸展，缩放后自动重定位当前行，布局见 [播放舞台记录](validation/2026-10-27-listening-layout.md)。设置页提供浅色、暗色与跟随系统，默认实时跟随桌面外观，单独保存公开枚举到 userData/appearance.json；见 [双主题记录](validation/2026-10-27-appearance.md)。

环境已提供 Corepack、但没有 pnpm 命令时，可直接执行以下命令，无需全局安装：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm setup:electron
corepack pnpm check
```

Corepack 不随所有 Node 分发提供；缺失时按 pnpm 官方安装说明安装 packageManager 指定版本。只有 Node 时仍可执行当前检查：

```bash
node --check scripts/check.mjs
node scripts/check.mjs
```

包管理器首次运行可能需要联网下载。已引入的直接依赖、版本、用途和许可见 [依赖记录](dependencies.md)。pnpm-workspace.yaml 保持 onlyBuiltDependencies 为空；Electron 运行时采用显式安装命令。凭据库已使用运行时内置 node:sqlite；其他后续依赖仍需单独审查。

受限环境若用户缓存目录只读，可将缓存定向到临时目录，无需修改全局配置：

```bash
export COREPACK_HOME=/tmp/starsmusic-corepack
export npm_config_cache=/tmp/starsmusic-npm-cache
export XDG_CACHE_HOME=/tmp/starsmusic-cache
export electron_config_cache=/tmp/starsmusic-electron-cache
corepack pnpm install --frozen-lockfile --store-dir /tmp/starsmusic-pnpm-store
corepack pnpm setup:electron
corepack pnpm dev
```

## 凭据持久化

记住登录位于各平台二维码区域，默认不勾选；本次扫码选择后，账号验证成功才保存。两个平台分别选择，取消/重新扫码/退出会撤销该平台选择并删除该平台保存项。设置页只显示保存状态与清除入口，不再提供全局开关。详见 [扫码保存记录](validation/2026-10-27-login-flow.md)。

- 凭据以 AES-256-GCM 加密后写到 `userData/credentials.sqlite`，本地随机 32 字节密钥单独存于 `userData/keys/login.key`；目录 0700、文件 0600（Linux 已验证）。
- 当前按用户选择不依赖 GNOME Keyring/KWallet；本地密钥与数据库同时被读取时可解密，不把它描述成系统密钥库隔离。应用不保存密码或二维码。
- SQLite 使用 Node/Electron 内置 `node:sqlite`，所有同步数据库操作在专用 Node worker 中执行；构建生成 `credential-store-worker.js`。没有新增 npm SQLite 绑定或系统数据库服务依赖。
- 启动时恢复必须重新请求平台账号接口；损坏、缺失密钥或存储不可用时显示原因，不覆盖旧密文，明确清除后才重建。
- 原 `credentials.json` 在新库未初始化且旧系统密钥仍可解密时自动转换，事务提交后才删除旧文件；无法解密时保留旧文件，需重新扫码保存。
- 范围、保护边界与结果见 [凭据持久化](credentials.md) 和 [SQLite 验证](validation/2026-10-26-sqlite-credentials.md)。

## 目录边界

| 目录 | 责任 |
| --- | --- |
| src/main | Electron 主进程入口、窗口、IPC 校验和生命周期 |
| src/preload | contextBridge API 白名单 |
| src/renderer | Vue 界面及状态投影 |
| packages/contracts | 领域模型、平台 ID、IPC 契约、归一化错误 |
| packages/providers | 网易云、酷狗和本地音乐的适配边界 |
| packages/playback | mpv 控制、队列、播放状态与歌词时间轴 |
| packages/storage | SQLite、迁移、缓存和标签索引 |
| packages/desktop | Linux MPRIS、通知、托盘与其他平台接口 |
| packaging | 各渠道打包配置和依赖记录 |
| scripts | 可直接执行的仓库工具 |
| docs | 设计、开发、决策及验证记录 |

main、preload、renderer、公共契约、会话守卫、网易云 Provider、酷狗 Provider、通用播放器、主进程 CredentialVault 和凭据 SQLite 后台已有实现，由根包统一检查。main 构建同时生成 index.js、netease-worker.js、kugou-worker.js、credential-store-worker.js 与 playback-session-worker.js；后台进程通过具体内部消息通信，凭据不进入 renderer。CredentialVault 只在主进程协调本地密钥加密/解密和异步存储；业务请求仍由后台进程使用解密后的临时凭据。队列存储已由独立 SQLite worker 实现，保存队列顺序、当前项、进度、音量与静音；重启暂停恢复、在线取链需原账号连接，详见 [播放说明](playback.md)。音乐库索引和系统集成仍为规划。尚未拆成独立工作区包，产生独立发布或依赖需求时再增加包配置。

公共 contracts 不导入 Electron/Vue/Provider SDK；renderer 只能使用 preload API。平台请求在 Provider 后台处理。重型扫描和数据库工作与窗口主进程分离。

## 日常开发

1. 阅读 AGENTS.md，检查 git status 和当前任务状态。
2. 对照 P0 验收目标完成最小闭环；有新发现就更新路线图和 ADR。
3. TypeScript 使用严格模式，代码命名英文；文档与用户提示默认中文。
4. 外部数据需运行时校验，ID 用 string，错误归一化，异步操作支持取消和过期事件丢弃。
5. 运行 pnpm check 与实际变更相关的验证，报告输出和环境。

新增依赖采用 pnpm，不并存 npm/yarn 锁文件。Node 运行时、依赖版本或入口命令变更时，同步更新文档、锁文件和 CI。

## Git 初始化与提交

仓库应使用 main 作为初始分支。Git 元数据受限时，通过环境提供的权限流程执行初始化，不把 .git 移到其他位置绕过限制。

默认不自动配置远程地址、推送、修改全局 Git 身份或创建发布标签。初始化与文件变更状态应分别记录；没有提交时明确说明尚无初始提交。

开发检查不要求联网、真实平台账号或读取用户主目录的凭据文件。
