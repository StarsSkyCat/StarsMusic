# 开发指南

## 当前能运行什么

已实现安全窗口、本地播放、网易云 App 临时扫码/歌单/播放，酷狗标准版 App 扫码、设备注册、账号验证、歌单/曲目分页、流解析和单曲播放，以及可选的系统密钥“记住登录”。preload 暴露 getAppInfo、playback、netease、kugou、credentials 的具体白名单方法；真实安全密钥持久化/跨重启恢复、目录扫描、SQLite、MPRIS 和安装包尚未验证或实现。

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
- probe:kugou 显式联网验证酷狗设备注册与匿名扫码挑战，只报告固定基线和通过状态，不输出设备标识、key、二维码或响应原文；不登录账号。
- test:playback 使用实际 mpv 与合成 WAV，显式指定 null 输出，验证本地/本机网关音频、试听上限、切歌、错误与清理；不调用平台、不需要账号。需要 Linux 与 mpv，缺失时失败。
- build 编译 main、单文件 CommonJS preload 与 renderer 到 out/，不执行类型检查、不生成安装包。
- start 运行上次构建产物；test:e2e 先构建，再启动 Electron 和实际 mpv，检查 IPC、安全边界、两个平台的匿名后台状态、本地选择、默认系统音频输出和退出，需 Linux、图形会话、mpv 和可用音频服务。原生选择器在测试中被替换为合成音频路径，播放本身不模拟。

当前 Linux 关闭窗口即退出；尚未实现托盘和后台播放。macOS 保留激活重建窗口的生命周期分支，尚未实机验证。当前页面已整理为石墨黑 / 雾紫音乐工作区，支持来源导航、平台歌单、已加载列表筛选、多选下一首、队列抽屉和展开播放页；系统主题跟随留待后续实现。范围和验证见 [界面记录](validation/2026-10-26-music-workspace.md)。

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

包管理器首次运行可能需要联网下载。已引入的直接依赖、版本、用途和许可见 [依赖记录](dependencies.md)。pnpm-workspace.yaml 保持 onlyBuiltDependencies 为空；Electron 运行时采用显式安装命令。SQLite 等后续依赖仍需单独审查。

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

“登录保存”面板默认关闭。勾选后需要成功登录才会保存；关闭勾选或点击“清除已保存登录”会删除保存项，退出单个平台会删除该平台保存项。

- 使用 Electron `safeStorage` 异步接口，凭据加密后写到 `userData/credentials.json`，目录 0700、文件 0600。
- Linux 只接受 `gnome_libsecret`、`kwallet`、`kwallet5`、`kwallet6`；`basic_text` 视为不可用，界面显示临时会话提示，不写入磁盘。
- 启动时只有记住已启用且后端可用才解密并发送给后台；后台重新调用账号接口验证后才进入 connected。
- 解密失败进入 locked，不覆盖原文件；清除保存后重新登录。
- 本机当前 `safeStorage` 为 `basic_text`，真实 GNOME Keyring/KWallet 保存和跨重启恢复未验证。范围与测试见 [凭据持久化](credentials.md) 与 [验证记录](validation/2026-10-26-credentials.md)。

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

main、preload、renderer、公共契约、会话守卫、网易云 Provider、酷狗 Provider、通用播放器和主进程 CredentialVault 已有实现，由根包统一检查。main 构建同时生成 index.js、netease-worker.js 与 kugou-worker.js；后台进程通过具体内部消息通信，凭据不进入 renderer。CredentialVault 只在主进程解密/加密；业务请求仍由后台进程使用解密后的临时凭据。存储和系统集成仍为规划。尚未拆成独立工作区包，产生独立发布或依赖需求时再增加包配置。

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
