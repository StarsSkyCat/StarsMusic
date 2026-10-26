# 安装包与分发

首批计划 Linux x86_64 的 AppImage、DEB、RPM；后续考虑 Flatpak 和 ARM64。当前尚无打包配置或发布产物。

原生包需声明并验证 mpv 依赖；便携包需记录 mpv/FFmpeg 构建、运行库与许可。安装后必须验证音频、MPRIS 和退出清理，不能仅凭构建通过宣称兼容。

实施顺序见 [开发路线图](../docs/roadmap.md)。
