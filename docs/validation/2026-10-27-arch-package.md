# Arch Linux 原生安装包验证

日期：2026-10-27。目标环境：本机 Arch Linux rolling、x86_64、niri / Wayland，XWayland 显示可用；系统 mpv 0.41.0、PipeWire。此记录不代表其他发行版、Windows/macOS 或其他架构兼容。

## 已实现

- 使用现有 Electron 45 官方运行时，pnpm 10 按锁文件部署生产依赖，通过 makepkg 生成 pacman 可安装的 `.pkg.tar.zst`；没有新增 npm 依赖。
- 安装目标为 /opt/starsmusic，入口 /usr/bin/starsmusic，桌面文件 org.starsmusic.StarsMusic.desktop，并提供原创 SVG 与 256px PNG 图标；继续使用系统 mpv，不捆绑其 FFmpeg 库。
- package.json 的 files 为明确的项目内容白名单，pnpm 机器路径元数据不进入运行包；路径/数据库/账号导出/测试产物检查、所有符号链接的包内边界检查通过。最终归档再次检查同类禁止路径。
- Electron 及 Chromium 随附许可、生产依赖自带许可、应用第三方声明保留；包的构建标识仅记录源码提交、是否本地修改、版本、平台与文件计数，不包含账号。整体项目许可与正式对外发行审计仍待完成。
- 安装版提供单实例锁与窗口图标，保持原有沙箱/CSP/preload 边界。没有添加禁用沙箱参数，也不复制、退出或删除本机已有登录数据。

## 安装前实际检查

第一份验证包成功生成（约 115 MiB、展开约 321 MiB），归档约 5600 个条目；账号/数据库/密钥/测试产物禁止路径检查为零。依赖均在包内，不依赖源码目录或其 node_modules。构建脚本重复运行会重建同一版本的生成产物。

使用独立临时配置实际启动包，Wayland 与 X11 均验证：

- app.isPackaged=true，StarsMusic 身份及 renderer 沙箱启用，两个实际后台 worker 启动为未登录，队列为空；没有使用用户测试账号。
- 通过原生文件选择器的测试替代注入现场生成的静音 PCM，实际 mpv 解码并使用 PipeWire 系统输出；不以 null 输出或假播放响应代替。
- session D-Bus 上实际 MPRIS Pause/Play 双向控制成功；第二次启动同一配置退出，并保留原窗口和队列。
- 页面无 renderer 异常。托盘状态当时为 unknown，未据此宣称当前 niri 环境托盘或全局快捷键已可用。

测试截图仅含临时匿名配置与合成本地音频，放在忽略的 artifacts/；安装包及依赖缓存在忽略的 release/。没有采集二维码、私人歌单或真实账号截图。

源码文档检查、严格类型检查、131 项单元测试和 15 项 Electron E2E 回归均通过；这些检查与包内 Wayland/X11 的实际运行检查分别记录，不相互替代。

## 系统安装

已通过系统 Polkit 授权执行 pacman -U，安装 `starsmusic 0.0.0.r54.gc0b4dd5b-1`。安装包由干净的源码提交 `c0b4dd5b5a45d966a62bef2d20ccced988a607dd` 生成，SHA-256 为 `da2c5a78fe87880fcddbff4b0bd82120e723818bd1059797de60e07588aada4b`，实际归档路径检查和校验和均通过。

`pacman -Qk starsmusic` 报告 5615 个文件、0 个缺失；入口、程序和桌面文件均归属于该包。实际宿主系统核对 chrome-sandbox 为 root:root / 4755，启动器为 root:root / 755（隔离工具内部可能把宿主 root 映射为 nobody，因此以宿主只读核对为准）。pacman 已运行图标与桌面 MIME 缓存更新钩子。

再次对 `/opt/starsmusic/starsmusic` 执行 `pnpm test:package`：Wayland/X11、实际 PipeWire 输出、两个未登录后台、MPRIS Pause/Play、单实例与 renderer 均通过；运行不依赖源码目录的 node_modules。应用菜单可搜索 StarsMusic，终端命令为 starsmusic。测试使用临时 userData，未读取或改动用户原登录/队列。

仅完成本机 Arch 安装验证，没有发布到发行渠道；当前 niri 托盘仍为 unknown，全局快捷键、其他发行版及真实账号/会员矩阵继续保留待验收。
