# 当前依赖记录

当前直接依赖如下，版本固定于 package.json，完整树及校验值由 pnpm-lock.yaml 记录。来源为 npm 官方注册表与对应项目；未复制参考播放器代码或视觉资产，协议格式改编来源另列 [第三方声明](../THIRD_PARTY_NOTICES.md)。

| 依赖 | 版本 | 用途 | 许可 |
| --- | --- | --- | --- |
| @lucide/vue | 1.61.0 | 实际界面使用的统一线性图标 | ISC；源于 Feather 的图标含 MIT，见 [完整声明](licenses/lucide.txt) |
| dbus-next | 0.10.2 | Linux MPRIS、session D-Bus 服务探测与后续 portal 操作 | MIT，见 [许可](licenses/dbus-next.txt) |
| vue | 3.5.44 | 实际桌面页面与响应式状态 | MIT |
| electron | 45.0.0 | 桌面运行时、窗口、沙箱与 IPC | MIT |
| electron-builder | 26.18.0 | Windows x64 NSIS EXE 构建，仅开发使用 | MIT |
| electron-vite | 6.0.0 | main / preload / renderer 开发与构建 | MIT |
| vite | 8.3.5 | 开发服务器与打包 | MIT |
| @vitejs/plugin-vue | 6.0.10 | Vue 单文件组件编译 | MIT |
| typescript | 5.9.3 | 严格类型检查；与本次构建工具及 vue-tsc 一起验证 | Apache-2.0 |
| vue-tsc | 3.3.13 | Vue 模板与 TypeScript 检查 | MIT |
| @types/node | 24.19.2 | 与 Node 24 开发基线一致的类型 | MIT |
| @playwright/test | 1.64.1 | 实际 Electron 启动、桥接与生命周期冒烟 | Apache-2.0 |
| qrcode | 1.5.4 | 后台把官方登录挑战 URL 转为内存 PNG | MIT |
| @types/qrcode | 1.5.6 | 二维码生成器类型检查 | MIT |

Vue、@lucide/vue、qrcode 和 dbus-next 为应用依赖，其余为开发依赖。SQLite 凭据库使用 Node/Electron 内置 node:sqlite；Pinia 和 Router 未使用，因此未安装；Windows 使用 electron-builder，Arch 仍采用 pnpm deploy、系统 makepkg/fakeroot 与 librsvg。网易云协议以 api-enhanced 4.41.1 固定源码为基线，酷狗协议以 KuGouMusicApi 1.6.2 固定源码为基线，均使用 Node 内置 crypto/fetch 实现白名单端点，未安装或加载完整 SDK；只新增实际使用的二维码依赖和类型。系统 mpv 仍作为子进程使用。凭据保险库使用 Node 内置 crypto/fs 与 node:sqlite，没有新增 npm SQLite 绑定或密钥管理依赖。node:sqlite 随固定的 Electron 45/Node 24 运行时提供，Node 为 MIT、SQLite 核心为公有领域；完整运行时许可仍随发行物审查。safeStorage 仅用于旧加密 JSON 的可选迁移。

## 系统音频依赖

Windows 开发验证使用 mpv 官方 CI 的 `v0.41.0-dev-gad5877eda` MSVC x86_64 构建，用于开发与 Windows 本地验证安装包，固定文件清单与校验值见 packaging/windows/mpv-runtime.json。mpv 核心及 FFmpeg/其他链接库的具体组合许可仍需在确定发行构建时完整审查；未新增 npm 播放器绑定，也未运行构建包附带的注册脚本。来源、SHA256 与结果见 [Windows 记录](validation/2026-10-28-windows.md)。

当前验证 /usr/bin/mpv 0.41.0，Arch 包版本 1:0.41.0-6，包元数据许可为 GPL-2.0-or-later AND LGPL-2.1-or-later；其 FFmpeg 运行时为 n9.0.2。开发阶段使用用户系统已安装的 mpv，不复制二进制到仓库、不自动安装系统包。正式分发时仍需追溯实际 mpv/FFmpeg 构建配置、组件许可和源码获取方式；系统包的许可元数据不替代发行审计。

## 安装行为

Windows EXE 构建使用 electron-builder 26.18.0，其 NSIS/7-Zip 工具显式下载到忽略的构建缓存；electron-winstaller 的生命周期脚本保持禁用，本目标不使用 Squirrel。生产包不包含 electron-builder。原始 mpv Copyright、GPL/LGPL 文本和 Vulkan Loader 许可随本地包保留，完整静态依赖许可/对应源码组合仍待公开发行审查，见 [Windows 运行时声明](../packaging/windows/THIRD_PARTY.md)。

本次依赖树未要求依赖生命周期构建脚本，onlyBuiltDependencies 保持为空。Electron 45 包提供显式 install-electron 工具；pnpm setup:electron 调用该工具，下载固定版本的官方平台二进制并使用包内 checksums.json 校验，再由 @electron-internal/extract-zip 解压到 node_modules。此命令需要网络和缓存写入，不修改系统沙箱、不以 root 启动、不使用 --no-sandbox。

Rolldown、Electron ZIP 解压器等传递依赖包含平台预编译原生包，当前只在本次 Linux x86_64 环境验证。锁文件不替代原生包的发行兼容性和完整第三方许可审计；Electron/Chromium 的附带许可在正式分发时仍需纳入清单。

## 官方参考

- [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)
- [electron-vite 开发指南](https://electron-vite.org/guide/dev)
- [Playwright Electron](https://playwright.dev/docs/api/class-electron)：自动化 API 仍标为实验性。
- [KuGouMusicApi 1.6.2](https://github.com/MakcRe/KuGouMusicApi/tree/62730f900dc9fdc51396a663b3d33a6c4c704046)：酷狗协议格式与端点基线，MIT；来源声明见 [第三方记录](../THIRD_PARTY_NOTICES.md)。

## Linux D-Bus 依赖边界

[dbus-next 0.10.2](https://github.com/dbusjs/node-dbus-next/tree/v0.10.2) 仅用于可信 Linux 桌面适配层。仓库 `patches/dbus-next@0.10.2.patch` 去除 Hello 失败后再抛出的未处理 rejection，保留 error 事件，避免 session bus 失效终止音频应用。其 xml2js 定向覆盖为 0.6.2（MIT），避免旧版本漏洞；生产依赖 `pnpm audit --prod` 实际通过。可选 usocket 被 ignoredOptionalDependencies 明确排除，连接经 Node 24 Unix socket 实现，不引入 Electron ABI addon 或生命周期编译脚本；abstract Unix socket 同样经 Node 的原生支持。完整传递依赖仍以锁文件和发行许可审计为准。

## Arch 验证包

包使用固定 Electron 45，保留其 LICENSE / LICENSES.chromium.html 与生产依赖许可。makepkg/fakeroot、tar/zstd、rsvg-convert（librsvg）、desktop-file-validate（desktop-file-utils）均为本机已有系统构建工具，不捆入应用；运行时 GTK、NSS、Mesa、ALSA、D-Bus 等依赖在 PKGBUILD 明确声明，mpv/FFmpeg 仍由系统包提供。该包仅用于本机安装验证，不代替后续完整对外发行许可审计。
