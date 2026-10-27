# 循环、随机与 MPRIS 播放模式

日期：2026-10-27。按用户最新要求，底栏只保留一个三态按钮。

## 实际行为

- 按钮依次切换列表循环 → 随机播放 → 单曲循环，图标、悬停提示与辅助名称显示当前模式，默认列表循环。
- `setMode` 仅接受三种明确枚举，通过一次 IPC 原子更新 MusicPlayer。随机与循环互斥，切换不会重启当前音频；暂停和停放状态保留。
- 随机顺序反映在队列及下一首中，一轮无重复，到末尾结束；离开随机恢复原序，删除项不恢复。列表循环末尾回到第一首；单曲循环只在自然 EOF 重播，手动切歌仍可换曲。错误不触发自动循环。
- 模式、随机顺序和原序随 SQLite 队列保存，重启暂停恢复。兼容旧记录时，旧组合开关中随机优先；旧顺序/缺省转换为列表循环。表结构不变，无新增依赖，不保存流地址或凭据。

## MPRIS 映射

| 当前模式 | LoopStatus | Shuffle |
| --- | --- | --- |
| 列表循环 | Playlist | false |
| 随机播放 | None | true |
| 单曲循环 | Track | false |

设置 Playlist / Track 会退出随机；设置 Shuffle=true 或 LoopStatus=None 进入随机；关闭随机进入列表循环，已处于单曲循环时重复写 Shuffle=false 不改变模式。两项属性通过同一状态源广播 PropertiesChanged，不产生中间组合状态；无效类型/值拒绝。托盘、快捷键和 CanGoNext / CanGoPrevious 沿用同一队列导航。参考 [官方 Player 接口](https://specifications.freedesktop.org/mpris/latest/Player_Interface.html)。

## 验证

- 单元检查三态参数白名单、一次切换仅发布一个互斥状态、旧组合归一、保留当前曲目/代次、恢复原序及跨 SQLite 实例保存。
- 真实 mpv 使用现场合成 WAV 和 null 输出，验证随机到末尾结束、列表回绕、单曲重播、试听限制、停止不自动重播及唯一音频进程。
- 隔离真实 D-Bus 验证属性读写、变更信号、非法值、首尾回绕和暂停/停放切歌。Electron + 真实 mpv 检查单按钮完整三态切换、UI/MPRIS 双向同步、互斥状态和真实重启恢复。
- 浅色/暗色分别检查 960、1150、1241、1440px，底栏按钮无重叠，原完整播放/音质标签回归保留；截图仅含合成音频和测试界面，位于忽略目录 artifacts/playback-modes-*.png。
- 已通过 pnpm typecheck、119 项单元测试、8 项真实 mpv 测试、6 项隔离桌面集成、构建及 13 项完整 Electron E2E、pnpm check 和 git diff --check。
- 实测仅限本机 Linux，合成 WAV、mpv null 输出/实际 PipeWire 与隔离 session D-Bus；不代表 GNOME/KDE 面板控件、真实在线账号和安装包矩阵已验收。
