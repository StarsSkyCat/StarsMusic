# StarsMusic

基于 Electron、Vue 3、TypeScript、mpv 和 SQLite 的桌面音乐播放器，支持本地音乐、网易云音乐与酷狗音乐。Linux 优先，Windows 已有开发适配，macOS 尚未适配。

项目处于早期开发阶段。源码采用 [MIT 许可证](LICENSE)，当前安装包用于本地验证，尚未完成公开发行验收。

## 功能

- **本地播放**：选择音频文件，播放、暂停、定位、音量与静音控制。
- **在线音乐**：网易云与酷狗独立扫码登录，浏览歌单、搜索歌曲与歌单、读取私人歌单；公开内容支持匿名浏览。
- **统一队列**：整单播放、多选加入下一首、列表循环、随机播放与单曲循环；重启后暂停恢复队列和进度；资源不可用时等待 2.5 秒自动尝试下一首，整队失败后停止。
- **播放页面**：在线歌曲封面与行级歌词、浅色 / 暗色 / 跟随系统主题。
- **登录保存**：可按平台选择加密记住登录，默认使用临时会话。
- **桌面集成**：Linux MPRIS、通知、托盘和快捷键；Windows 托盘、窗口控制与全局快捷键。

网易云喜欢、收藏与自建歌单单曲编辑已有实现，真实账号写入仍待验收；酷狗歌单目前只读，部分歌曲受平台权限或资源限制。登录成功不代表所有歌曲或音质可播放，应用按平台实际响应区分完整播放、试听与不可用，不提供音源解锁。

本地目录扫描、标签索引、独立播放历史、无缝播放、逐字与桌面歌词尚未实现。更多限制见 [平台接入](docs/providers.md) 与 [路线图](docs/roadmap.md)。

## 平台支持

| 平台 | 当前状态 |
| --- | --- |
| Linux x86_64 | 首要目标；Arch Linux 有本机安装、PipeWire、MPRIS 和 Wayland / XWayland 验证记录，其他发行版与桌面仍待验证 |
| Windows x64 | 已验证本地播放、托盘、窗口控制及 EXE 安装 / 运行 / 卸载；未签名，系统媒体控制与兼容性矩阵待完成 |
| macOS | 尚未适配和实机验证 |

现有验证的环境、范围和限制见 [测试说明](docs/testing.md)。

## 从源码运行

准备 Git、Node.js **24.x**、pnpm **10.34.9**，以及可在当前终端 PATH 中运行的 **mpv**（Windows 为 mpv.exe）。播放需要可用的图形与音频会话。

```bash
git clone https://github.com/StarsSkyCat/StarsMusic.git
cd StarsMusic
pnpm install --frozen-lockfile
pnpm setup:electron
pnpm dev
```

首次安装依赖和 Electron 运行时需要联网。仅检查文档、类型、单元测试或构建应用代码时不需要 mpv。Windows 的 PATH 设置、桌面差异见 [平台说明](docs/platforms.md)。

## 开发与构建

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

`build` 生成 out/ 下的应用代码；`start` 运行已有构建。音频集成测试、桌面测试和本机打包要求见 [开发指南](docs/development.md)、[测试说明](docs/testing.md) 与 [打包说明](packaging/README.md)。

### 构建 Windows EXE 安装包

在 **Windows x64** 上准备 Node.js 24.x、pnpm 10.34.9，并将 [固定运行时清单](packaging/windows/mpv-runtime.json) 对应的 `mpv.exe` 和 `vulkan-1.dll` 放入仓库的 `.local/mpv/`。构建会校验两个文件的 SHA-256，不能直接替换成任意 mpv 版本；也可通过环境变量 `STARSMUSIC_MPV_DIR` 指定所在目录。

在仓库根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm setup:electron
pnpm package:win
```

`package:win` 自动执行类型检查、应用构建、生产依赖部署和 NSIS 打包，无需先手动执行 `pnpm build`。首次准备依赖和打包工具需要联网。

产物为 `release/windows-<版本>/StarsMusic-<版本>-x64-Setup.exe`，同时生成 `.exe.sha256` 和 `win-unpacked/` 独立运行目录；`release/latest-windows.json` 记录实际路径与校验值。安装包内置 mpv，安装后无需另行配置 PATH。

构建后可验证独立运行目录：

```powershell
pnpm test:package:win
```

若需验证真实安装和卸载，运行 `pnpm test:installer:win`；该命令会在临时目录实际安装、测试并卸载，发现既有 StarsMusic 安装或默认用户数据时拒绝运行。新构建安装包正式卸载会删除默认应用数据，升级保留数据；自定义路径和旧包的边界见打包说明。当前包未签名，完整要求和发行限制见 [打包说明](packaging/README.md)。

## 项目结构

```text
src/          Electron 主进程、preload 与 Vue 界面
packages/     公共契约、平台接入、播放、存储和系统适配
tests/        单元测试、mpv / D-Bus 集成测试与 Electron E2E
packaging/    Linux / Windows 打包配置、图标与运行时声明
scripts/      检查、匿名探测、打包和安装验证工具
patches/      依赖补丁
docs/         长期维护的开发与使用说明、第三方许可文本
```

完整模块边界见 [架构说明](docs/architecture.md)。

## 文档与参与

- [文档索引](docs/README.md) · [开发指南](docs/development.md) · [路线图](docs/roadmap.md)
- [贡献指南](CONTRIBUTING.md) · [协作规则](AGENTS.md)
- [安全与本地数据](docs/security.md) · [安全问题报告](SECURITY.md)

扫码授权请在对应官方 App 内完成。选择记住登录后，凭据使用本地随机密钥加密并写入 SQLite；密钥与数据库分文件保存，**同时取得两者即可解密**。真实账号跨重启恢复和完整会员权限矩阵仍待验收。

## 许可证

StarsMusic 自有源码采用 [MIT License](LICENSE)。第三方代码、依赖与运行时保留各自的许可证，来源和声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [依赖清单](docs/dependencies.md)。平台名称、标识及音乐内容的权利归各自权利人所有，项目与相关音乐平台无隶属关系。

Windows 验证包内置的 mpv 按 GPL 构建处理；其静态依赖许可与对应源码材料仍需在公开分发前补齐，见 [运行时声明](packaging/windows/THIRD_PARTY.md)。
