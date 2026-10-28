# 播放服务

src/player.ts 的 MusicPlayer 拥有临时队列与唯一播放状态源，支持本地与后台解析的网易云、酷狗单曲，以及网易云整张歌单。src/media-gateway.ts 管理按平台隔离的 CDN/跳转/Range 边界；src/mpv-client.ts 管理 Linux 私有 FD、Windows 随机命名管道、JSON 关联和子进程。独立 playback generation 隔离切歌，旧进程退出后才启动新实例。

已有实际 mpv、合成远端网关和桌面测试，以及网易云用户真实出声反馈。范围见 [播放说明](../../docs/playback.md)、[网易云说明](../../docs/netease.md) 与 [酷狗说明](../../docs/kugou.md)。行级歌词与 MPRIS 订阅同一状态，列表续播、列表循环、单曲循环、随机播放及持久队列已实现，三种播放模式互斥；模式和原顺序随队列保存，见 [播放模式验证](../../docs/validation/2026-10-27-playback-modes.md)。

openRemoteList 原子替换最多 10000 首元数据队列并从第一首开始，后续歌曲到播放时才解析。普通本地文件导入仍最多 200 个路径；普通在线追加/下一首共享 10000 首队列上限。
