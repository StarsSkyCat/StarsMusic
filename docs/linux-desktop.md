# Linux 桌面集成

在「账号与设置 → 桌面集成」查看当前能力、重新检测服务、测试通知及设置快捷键。设置只保存四个布尔选项到 `userData/desktop.json`，不保存 D-Bus 地址、portal 会话、授权结果或凭据；每次启动重新检测。Windows/macOS 的系统实现仍待完成，界面不会把它们显示为 Linux 功能已支持。

## 平台边界

`packages/desktop/src/platform.ts` 定义播放器、窗口与平台服务接口，`controller.ts` 协调能力和设置，`linux/` 处理 D-Bus、MPRIS、通知、StatusNotifier 与 portal。main 只传入唯一 MusicPlayer/PresentationController 和窗口生命周期，renderer 通过窄 `system` 白名单投影状态，不调用 Linux 接口或进程。

所有位置来自同一播放器；MPRIS、托盘、窗口快捷键和全局快捷键不会创建另一个音频实例。退出先取消 portal 请求/会话、销毁托盘、注销本应用注册的快捷键、关闭通知、删除临时封面、断开总线，再保存播放记录及销毁音频和平台会话。桌面服务错误不应阻断音频与退出。

## MPRIS 与媒体键

每实例服务名 `org.mpris.MediaPlayer2.StarsMusic.instance<PID>`，对象路径 `/org/mpris/MediaPlayer2`。实现根接口与 Player，支持播放、暂停、停止、上一首/下一首、相对 Seek、带当前 TrackId 的 SetPosition、音量、显示窗口、退出，以及状态、曲目、歌手、时长、位置和当前封面。微秒位置用 D-Bus int64，正常位置更新不发送 PropertiesChanged(Position)，确认定位后发送 Seeked；旧 ID、负值及越界 SetPosition 忽略。

mpv 的命令回执可能早于实际定位；定位按代次/序号串行合并，等待 seek/playback-restart 后回读实际位置，切歌/停止使旧请求失效。不用请求目标伪造实际进度。暂停/停止时系统切歌保持原状态。速率固定为 1，不提供 TrackList。已实现可读写 LoopStatus（None / Playlist / Track）和 Shuffle；模式修改广播 PropertiesChanged，界面、MPRIS、托盘与快捷键共用 MusicPlayer 的队列导航，CanGoNext / CanGoPrevious 随循环模式变化。暂停/停止时切换模式不启动音频。实现与双向验证见 [播放模式记录](validation/2026-10-27-playback-modes.md)。OpenUri 明确拒绝，系统客户端不能借此请求任意地址或文件路径。

媒体键交给桌面经 MPRIS 路由，不再次抢占 MediaPlayPause/MediaNext 等全局键。桌面是否提供媒体面板、锁屏控制和激活窗口的权限，由实际桌面决定。

封面仅来自当前 generation/TrackId 已校验的内存 PNG/JPEG/WebP，写入私有临时目录并以 file URI 提供给同用户的桌面客户端，文件权限 0600；换图或退出时删除。MPRIS 不公开原音频路径、CDN 地址、Cookie 或 Token。歌曲元数据是此功能向会话桌面客户端公开的内容。

## 托盘与关闭窗口

托盘默认开启；只有实际 StatusNotifier watcher 与显示宿主存在才尝试创建。原生 Tray 对象创建成功后仍保持「未确认」，直到宿主 RegisteredStatusNotifierItems 中确认属于当前进程的条目。注册完成也不保证桌面把图标显示出来，需看桌面面板/扩展实际状态。没有宿主或无法确认时不假装可用；当前未实现独立的 XEmbed 托盘探测。

菜单提供显示/隐藏窗口、播放/暂停、切歌、静音和退出。默认关闭窗口退出；用户确认图标可见后可打开「关闭窗口后留在托盘」。关闭到托盘同时要求该设置、当前图标与宿主注册仍成立。宿主或注册丢失会恢复隐藏主窗口，关闭按钮恢复退出；设置页始终保留退出入口。关闭托盘选项会同时关闭“关闭到托盘”。

## 通知

后台切歌通知默认关闭，可自行开启。窗口隐藏或最小化时，实际新曲目开始播放才通知；暂停/继续、音量和位置更新不重复通知。通过实际 org.freedesktop.Notifications 服务发送，检查返回 ID、复用本应用通知、转义支持 markup 的正文并请求静音提示；只有合法来源、匹配 ID 的点击才能打开窗口。禁用或退出撤回本应用通知。

「发送测试通知」只发固定测试文案。显示“服务已接收”表示方法返回了合法 ID，不等于用户看到了弹窗；免打扰、通知策略和桌面设置仍可能隐藏它。

## 快捷键与 Wayland

| 动作 | 窗口内组合键 / 请求的全局默认键 |
| --- | --- |
| 播放 / 暂停 | Ctrl + Alt + Space |
| 上一首 | Ctrl + Alt + Left |
| 下一首 | Ctrl + Alt + Right |
| 静音切换 | Ctrl + Alt + M |
| 显示主窗口 | Ctrl + Alt + O |

窗口内键不要求全局授权；过滤自动重复和其他修饰键，同一次按键来自窗口与全局回调时去重。

全局键默认关闭，需要主动启用。X11 逐项调用 Electron 注册并显示每项返回结果，冲突项不标成功；退出只注销本应用实际注册项。Wayland 直接通过 GlobalShortcuts portal 创建会话/申请绑定，先订阅 Response 再发请求，验证服务来源、请求路径和会话，实际成功返回的绑定才显示可用；部分批准、取消、拒绝、超时或会话关闭分别反映在状态中。设置页显示 portal 返回的实际键描述，未批准项继续使用窗口内组合键。关闭开关取消未完成的请求并关闭会话，不静默假定原授权永久有效。

XDG_SESSION_TYPE 和桌面名只作为会话声明显示，不代表 Electron 渲染后端或全部 Wayland 功能已经验证。portal 服务存在、GlobalShortcuts 接口版本存在、请求已提交、绑定已确认是不同状态；实际后端/合成器、桌面身份、用户授权和快捷键冲突共同决定能否使用。监听服务变化并每 30 秒复查；可主动重新检测后重试。

应用使用 `org.starsmusic.StarsMusic.desktop` 身份；分发模板在 `packaging/linux/org.starsmusic.StarsMusic.desktop.in`。发行包需将匹配的 .desktop、可执行文件和图标安装到正确位置，当前模板不等于已安装。开发启动、缺少匹配桌面入口或 portal 后端不支持时，绑定可能被拒绝；实际错误通过能力状态反映，不修改用户系统以绕过授权。

## 验证边界和依据

自动化验证结果见 [Linux 桌面记录](validation/2026-10-27-linux-desktop.md)。真实 MPRIS / mpv、原生 Electron 托盘注册和菜单、隔离总线的合成 portal/通知协议均已验证；合成服务不运行在用户真实桌面总线上，不等同 GNOME/KDE 实机授权、图标可见或通知弹窗验收。发行包、X11 实机及其他桌面矩阵仍待完成。

实现依据：[MPRIS 2.2](https://specifications.freedesktop.org/mpris/latest/)、[通知协议](https://specifications.freedesktop.org/notification/latest/protocol.html)、[GlobalShortcuts portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html)、[Request 订阅时序](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Request.html)、[快捷键语法](https://specifications.freedesktop.org/shortcuts/latest/) 和 [Electron 45 globalShortcut](https://github.com/electron/electron/blob/v45.0.0/docs/api/global-shortcut.md)。
