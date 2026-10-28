# Windows 本地验证包的第三方音频运行时

本包为 StarsMusic 本地开发验证安装包，应用自有源码采用 MIT；内置音频运行时保留各自许可证，对外发行审计尚未完成。

- mpv：官方 Windows MSVC x64 CI 构建 `v0.41.0-dev-gad5877eda`，2026-10-27 构建。[源码与构建入口](https://github.com/mpv-player/mpv/tree/ad5877eda)，二进制及归档校验值见同目录 `BUILD-SOURCE.json`。
- 该 mpv 的构建参数包含 `-Dgpl=true` 与 `-Dffmpeg:gpl=enabled`，按 GPL 构建处理；不将它描述成纯 LGPL。原始 Copyright、GPL v2 和 LGPL v2.1 文本位于 licenses/。
- FFmpeg：运行时报告版本 `1a0e6ce`；[官方源码](https://git.ffmpeg.org/ffmpeg.git)与[许可说明](https://ffmpeg.org/legal.html)。此 CI 构建还静态启用了 libass、libplacebo、LuaJIT、libcurl 等，完整对应源码、构建脚本及各链接库许可组合仍需在公开分发前补齐。
- Vulkan Loader：随原始 CI 归档的 `vulkan-1.dll`，随附其 Apache-2.0 许可文本；[上游来源](https://github.com/KhronosGroup/Vulkan-Loader)。

Electron 的 LICENSE 和 Chromium 许可随运行时保留；应用 Provider 与生产 npm 依赖声明位于 resources/app/THIRD_PARTY_NOTICES.md 及各依赖目录。安装程序不执行 mpv 注册脚本，不注册媒体文件关联，不修改系统 PATH。
