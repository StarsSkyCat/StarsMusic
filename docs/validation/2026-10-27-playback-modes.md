# 循环、随机与 MPRIS 播放模式

日期：2026-10-27。

## 第一步：统一播放核心与保存

- 增加顺序、列表循环、单曲循环及独立随机开关，状态属于 MusicPlayer；提供严格白名单模式/导航 IPC。
- 随机顺序直接反映在队列与下一首中，当前歌曲不重启；一轮内不重复，关闭随机恢复原序。循环沿用本轮顺序。手动上一首/下一首按队列切换，暂停或停放时保持原状态；快速切歌仍使用 generation 与串行 mpv 清理。
- 模式和随机原序随现有 SQLite 记录保存，旧字段缺省兼容；没有新增依赖和表结构迁移，不保存流地址或凭据。
- 已通过 pnpm typecheck、118 项单元测试、8 项真实 mpv 集成测试、pnpm check 和 git diff --check。新增真实 EOF 检查顺序结束、列表回绕、单曲重播、随机逐首播放及停止后不重播，采用现场合成 WAV 和 null 输出。
- UI 和 MPRIS 属性接入安排在下一步；当前结果不代表真实平台账号和发行包验证。

## 第二步：底栏与 MPRIS 双向控制

- 底栏新增随机开关和循环按钮，循环按钮依次切换顺序播放 / 列表循环 / 单曲循环，激活态、悬停说明和辅助名称同步显示；随机与循环可独立组合。播放页“接下来”按循环与实际队列显示，托盘和快捷键沿用统一导航。
- MPRIS 提供可读写 `LoopStatus`（None / Playlist / Track）与 `Shuffle`，更改广播 `PropertiesChanged`；无效值/类型拒绝，`CanGoNext` / `CanGoPrevious` 在循环模式下正确回绕。参考 [官方 Player 接口](https://specifications.freedesktop.org/mpris/latest/Player_Interface.html)。
- 隔离真实 D-Bus 集成覆盖属性读写、变更信号、非法值、首尾回绕和停放状态。新增 Electron + 真实 mpv 用例覆盖 UI → MPRIS、MPRIS → UI、暂停切歌、模式更改不重启当前音频、真实 SQLite 重启恢复及关闭随机恢复原序。
- 浅色/暗色分别检查 960、1150、1241、1440px，六个底栏按钮无重叠；已有底栏信息回归继续检查完整播放/音质标签不截断。截图仅含合成音频和测试界面，位于忽略目录 artifacts/playback-modes-*.png。
- 已通过 pnpm typecheck、118 项单元测试、8 项真实 mpv 测试、6 项隔离桌面集成、构建及 13 项完整 Electron E2E、pnpm check 和 git diff --check。
- 实测环境为本机 Linux，合成 WAV、mpv null 输出/实际 PipeWire 与隔离 session D-Bus；不代表 GNOME/KDE 面板控件、真实在线账号和安装包矩阵已验收。
