# 平台说明

当前目标是 Linux x86_64 / glibc 和 Windows x64，macOS 尚未适配。源码版本与安装包通过情况不能替代完整系统兼容性验证，历史环境见 [测试说明](testing.md)。

## Linux

开发播放使用系统 mpv，已有 mpv 0.41.0 / PipeWire 本机记录。Arch 原生包依赖系统 mpv，不捆绑 mpv / FFmpeg；构建和安装命令见 [打包说明](../packaging/README.md)。

Linux 集成由 packages/desktop/src/linux/ 承载：

- **MPRIS**：播放、暂停、切歌、定位、音量、元数据、Shuffle / LoopStatus 与唯一播放器双向同步。
- **通知**：后台切歌通知默认关闭，仅在新曲目实际开始时发送；服务接收不保证用户看见弹窗，受免打扰和桌面策略影响。
- **托盘**：按实际宿主注册报告能力。默认关闭窗口退出；可选关闭到托盘，宿主丢失或禁用托盘时恢复窗口，并保留退出入口。
- **全局键**：默认关闭；X11 逐项检查 Electron 注册结果，Wayland 经 GlobalShortcuts portal 请求授权，只有实际返回的绑定才标为可用。

设置页区分 available / unavailable / unknown / pending / disabled，不把存在 D-Bus 服务视为能力验收。应用桌面身份为 org.starsmusic.StarsMusic.desktop，必须与实际安装的桌面入口匹配；开发环境的 portal 申请可能被桌面后端拒绝。

## Windows

开发播放需自行准备 mpv.exe，并加入当前 PowerShell 的 PATH：

```powershell
$env:PATH = 'C:\Tools\mpv;' + $env:PATH
mpv.exe --version
pnpm install --frozen-lockfile
pnpm setup:electron
pnpm dev
```

示例目录替换为实际位置。Windows EXE 安装版固定使用 resources/mpv/mpv.exe，并校验构建输入，不从 PATH 回退。当前用户安装、可选路径、快捷方式与卸载入口已实现，卸载保留用户数据。安装包未签名，仍为本地验证用途。

已实现共用托盘菜单、可选关闭到托盘、原生窗口控制和逐项报告注册结果的全局快捷键。AppUserModelID 为 org.starsmusic.StarsMusic。通知、系统媒体面板、专用媒体键和任务栏媒体控件尚未接入；设置页不显示 Linux 专用能力。

mpv 使用每实例随机命名管道、shell=false 和 windowsHide，不弹出控制台。管道访问限制由 mpv 的 Windows 实现提供，不隔离同用户同级进程。Windows 本地数据权限依赖用户目录的 NTFS ACL，不能用 POSIX 0700 / 0600 宣称其 ACL 已隔离。

## 窗口和快捷键

Linux / Windows 提供最小化、最大化 / 还原与关闭按钮，顶部空白区域可拖动。关闭遵循托盘选项。macOS 保留原生窗口按钮分支，但尚未实机验证。

| 动作 | 窗口内组合键 / 请求的全局默认键 |
| --- | --- |
| 播放 / 暂停 | Ctrl + Alt + Space |
| 上一首 / 下一首 | Ctrl + Alt + Left / Right |
| 静音 | Ctrl + Alt + M |
| 显示窗口 | Ctrl + Alt + O |

窗口内键不要求全局授权。全局键受宿主、冲突和用户授权影响，具体以设置页实际状态为准。

## 尚未覆盖

其他 Linux 发行格式和 GNOME / KDE 真实桌面矩阵、Windows 版本 / 缩放 / 音频设备矩阵、签名与升级、ARM64 和 macOS 均需继续开发或验收。niri / XWayland 的已有窗口行为不能泛化为所有 X11 桌面结果。
