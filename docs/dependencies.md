# 依赖与许可

直接依赖的精确版本以 package.json 为准，完整依赖树与校验值见 pnpm-lock.yaml。以下记录当前用途；协议参考来源和许可原文见 [第三方声明](../THIRD_PARTY_NOTICES.md)。

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

## 运行时与生产依赖

Vue、@lucide/vue、qrcode 和 dbus-next 为生产依赖，其余是开发依赖。平台接口用 Node 内置 crypto / fetch 实现固定端点，没有安装完整参考 SDK。SQLite 使用固定 Node / Electron 的 node:sqlite，不依赖额外 npm SQLite 绑定或数据库服务；Node 为 MIT，SQLite 核心为公有领域。safeStorage 仅用于旧加密文件的可选迁移。

Electron / Chromium 的 LICENSE 与 LICENSES.chromium.html 需随运行时保留；npm 直接依赖表不能替代完整传递依赖的发行许可清单。

## 安装与补丁

pnpm-workspace.yaml 禁用依赖生命周期脚本；Electron 通过 setup:electron 显式下载并校验。构建工具的原生预编译包仍需按目标平台验证。

Linux 使用 dbus-next 0.10.2。patches/dbus-next@0.10.2.patch 修复 Hello 失败重复抛出的未处理 rejection，保留原 error 事件；xml2js 定向覆盖为 0.6.2（MIT）。可选 usocket 被排除，使用 Node Unix socket，不引入 Electron ABI addon。

electron-builder 26.18.0 仅用于 Windows NSIS 构建，工具缓存被忽略，生产包不包含此开发依赖；不使用 Squirrel 或其安装脚本。Arch 打包使用系统 makepkg / fakeroot、tar / zstd、librsvg 和 desktop-file-utils。

## mpv 与 FFmpeg

开发使用系统 mpv，不自动安装系统包。已有 Linux 验证版本为 mpv 0.41.0，Arch 包许可元数据为 GPL-2.0-or-later AND LGPL-2.1-or-later，FFmpeg 为 n9.0.2；该系统包元数据不替代其他构建的许可审查。Arch 安装包依赖系统 mpv / FFmpeg，不捆绑它们。

Windows 本地验证包使用固定官方 CI 构建 v0.41.0-dev-gad5877eda，mpv.exe 与 vulkan-1.dll 的清单和 SHA-256 见 [运行时清单](../packaging/windows/mpv-runtime.json)。其构建启用了 GPL，不能描述为纯 LGPL；已有 mpv Copyright、GPL / LGPL 和 Vulkan Loader 文本保存在 packaging/windows/licenses/，FFmpeg 与静态链接库完整对应源码和构建材料仍待补齐。详见 [Windows 第三方运行时](../packaging/windows/THIRD_PARTY.md)。

源码的 [MIT 许可证](../LICENSE) 不替代上述组件的原许可。当前打包脚本只提供本地验证包；公开分发前完成完整依赖清单与许可审查。
