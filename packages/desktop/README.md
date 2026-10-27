# 系统集成

通过平台接口逐步实现 Linux MPRIS、通知、托盘和快捷键，再扩展 Windows/macOS。Wayland 能力按实际桌面和 portal 状态声明，不能假定所有环境都支持。

已实现 Linux MPRIS 2 与会话 D-Bus 服务探测；通知发送、托盘和快捷键正在接入。位置/时长采用微秒 int64，系统控制共享唯一播放器；服务异常不影响音频核心。详见 [验证记录](../../docs/validation/2026-10-27-linux-desktop.md)。验证范围见 [测试与验收](../../docs/testing.md)。
