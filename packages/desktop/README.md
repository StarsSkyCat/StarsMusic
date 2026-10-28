# 系统集成

通过平台接口实现 Linux MPRIS、通知、托盘和快捷键，以及 Windows 托盘/全局快捷键。共用的 Electron runtime 与图标位于 src/ 根目录；平台探测分别位于 linux/ 和 windows/。Wayland 能力按实际桌面和 portal 状态声明，不能假定所有环境都支持。Windows 通知/系统媒体面板与 macOS 尚未接入，见 [Windows 说明](../../docs/windows.md)。

已实现 Linux MPRIS 2、会话 D-Bus 服务探测、通知、原生托盘、窗口快捷键与按会话选择的 X11/Wayland 全局键。托盘确认实际宿主注册，Wayland 按 portal 请求/会话/绑定响应报告状态，不能把服务存在等同完整可用。用户设置和默认行为见 [桌面说明](../../docs/linux-desktop.md)。位置/时长采用微秒 int64，系统控制共享唯一播放器；服务异常不影响音频核心。详见 [验证记录](../../docs/validation/2026-10-27-linux-desktop.md)。验证范围见 [测试与验收](../../docs/testing.md)。
