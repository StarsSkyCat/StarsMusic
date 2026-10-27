# Linux 桌面集成验证

日期：2026-10-27。用户要求通过平台接口接入 MPRIS、通知、托盘、快捷键，并按实际 Wayland/portal 状态声明能力。

## 第一步：MPRIS 与服务探测

- `packages/desktop/src` 提供平台接口与 Linux 实现，main 仅做生命周期协调，UI、歌词和 MPRIS 均使用同一 MusicPlayer 状态源。
- 每实例注册 `org.mpris.MediaPlayer2.StarsMusic.instance<PID>`，导出标准根接口和 Player。支持状态/元数据/时长/位置/音量、播放/暂停/停止/切歌、相对定位、带曲目 ID 的绝对定位、显示窗口和退出。位置/时长/Seeked 使用微秒 int64，旧曲目 SetPosition 不生效；未实现的 OpenUri 明确拒绝，循环/随机不宣称支持。
- 系统切歌保留暂停/停止状态；为播放器增加可信后台 cue 和暂停加载，避免通过媒体键暂停切歌时短暂出声。定位信号来自真实 mpv 定位回读或恢复书签调整，不由 UI 自行模拟。
- 连接只接受本地 Unix session bus，不执行 unixexec、不连接远端 TCP。以 D-Bus owner/实际方法和属性响应探测通知服务、StatusNotifier 宿主、portal 与 GlobalShortcuts 接口；仅接口存在时显示待确认，不等同快捷键已绑定。监听服务变化并定期重新检测；失败不改变音频核心。
- 使用 dbus-next 0.10.2 / MIT。禁用可选 usocket，使用 Node 24 Unix sockets；xml2js 覆盖为 0.6.2。仓库补丁修复库 Hello 失败的二次未处理 rejection，保留 error 事件供适配器降级，许可见 [声明](../licenses/dbus-next.txt)。生产依赖审计没有已知漏洞。

新增 `pnpm test:desktop` 已实际运行：在 dbus-run-session 隔离总线上使用真实 D-Bus / mpv、现场生成 WAV 和 null 输出，验证发现、接口、微秒元数据、音量、Seeked、旧 ID/越界定位、暂停切歌、停止 cue、Raise/Quit 和名称释放；验证无通知/托盘/portal 的环境不误报可用，以及不存在的总线安全降级。不会在用户桌面注入合成托盘、通知或 portal 服务。

当前实测宿主声明 niri / Wayland；真实服务查询发现通知服务、StatusNotifier 宿主以及 GlobalShortcuts v2。服务存在不代表图标已显示、通知已弹出或快捷键已授权。GNOME/KDE/X11、其他合成器、安装包和跨平台仍待实际验收。

第一步检查：`pnpm typecheck`、`pnpm test`（111 项）、`pnpm test:desktop`（2 项）、`pnpm test:playback`（7 项）、`pnpm test:e2e`（10 项，含构建）和 `pnpm check` 均通过。总线退出时 GetNameOwner 与名称释放存在竞态，已按 NameHasNoOwner 正确处理；一次性注销整个 MPRIS 对象，避免库的逐接口移除行为导致清理异常。
