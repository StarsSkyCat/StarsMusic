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

## 第二步：通知、托盘、快捷键与设置

- `system` 窄桥接增加能力投影、重新检测、四个布尔设置、固定测试通知与退出；不提供任意通知内容、D-Bus 目标、路径、命令或任意 accelerator。设置原子保存到独立 desktop.json，保存失败保持此前选项和注册状态，未知版本保留原文件。
- 托盘默认开启，“关闭到托盘”默认关闭。只有宿主存在才创建实际 Electron Tray，继续读取 RegisteredStatusNotifierItems 并核验属于本进程的条目；确认前显示未确认，不能启用关闭到托盘。宿主/注册丢失时恢复隐藏窗口。菜单包括显示/隐藏、播放控制、切歌、静音和退出，图标为原创 PNG。
- 后台切歌通知默认关闭；启用后只在窗口隐藏/最小化且新曲目开始播放时通知，状态/位置/音量不重复。实际 Notifications 服务返回合法 ID 才显示“服务已接收”，不宣称弹窗可见；正文按服务 markup 能力转义，点击校验来源/ID，禁用和退出关闭本应用通知。
- 全局键默认关闭。X11 逐项显示 Electron 注册结果；Wayland 通过实际 portal CreateSession/BindShortcuts 的 Response 确认，不用接口版本或请求提交冒充成功。覆盖早到 Response、部分绑定、取消/拒绝、未完成请求取消、旧会话与迟到结果；只执行绑定过的固定动作，关闭/退出清理会话和请求。BindShortcuts 的成功响应与 Session.Closed 同时到达时也保持不可用，不被稍晚的成功处理覆盖。窗口内同组键作为回退，同次窗口/全局回调去重，媒体键留给 MPRIS。
- MPRIS 当前封面用受限临时图片 file URI，按播放代次/曲目核对，退出删除；不公开原音频或 CDN 地址。
- 实际 Electron E2E 启动独立 dbus-daemon 与明确标识的合成 watcher/portal/notification 服务，验证原生 StatusNotifierItem 注册、D-BusMenu 的真实“显示 StarsMusic”动作、窗口输入事件、隐藏/恢复、通知点击、宿主丢失恢复，以及关闭选项和应用重启。合成服务不在真实用户总线上注册，不把此结果当作 GNOME/KDE 面板可见性或用户授权验收。
- 定位验证发现 mpv 暂停后的实际播放位置可能因音频缓冲低于请求目标少量时间；现等待 seek/playback-restart 后回读，串行合并并抛弃旧序号/代次。检查实际位置使用 0.3 秒边界，歌词用行中位置验收，避免在时间标签边界把目标值冒充实际状态。原有登录设置测试改为精确检查“记住登录”复选框，不把新增桌面设置误判成登录持久化回归。

第二步最终检查：`pnpm typecheck`、`pnpm test`（115 项）、`pnpm test:desktop`（6 项）、`pnpm test:playback`（7 项）、`pnpm test:e2e`（11 项，含构建）和 `pnpm check` 均通过。桌面入口源模板经 desktop-file-validate 通过，未安装到用户系统。依赖未在第二步增加；第一步生产依赖审计无已知漏洞。浅色设置页已检查实际截图；全套原有双主题、播放舞台、队列、平台发现和收藏桌面回归通过。

尚待实际验收：GNOME/KDE/X11 与其他 Wayland 后端、真实用户的全局键授权与硬件按键、真实面板上的图标/通知可见性、打包后的 desktop ID/图标安装和各发行版运行。桌面入口目前是分发模板，开发运行不保证所有 portal 后端接受此身份。Windows/macOS 未实现系统适配。以上未验收项不会在程序中无条件标记为已支持；文档说明见 [Linux 桌面集成](../linux-desktop.md)。
