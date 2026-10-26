# 播放服务

src/player.ts 的 MusicPlayer 拥有临时队列与唯一播放状态源，支持本地与后台解析的网易云、酷狗单曲。src/media-gateway.ts 管理按平台隔离的 CDN/跳转/Range 边界；src/mpv-client.ts 管理私有 FD、JSON 关联和子进程。独立 playback generation 隔离切歌，旧进程退出后才启动新实例。

已有实际 mpv、合成远端网关和桌面测试，以及网易云用户真实出声反馈。范围见 [播放说明](../../docs/playback.md)、[网易云说明](../../docs/netease.md) 与 [酷狗说明](../../docs/kugou.md)。歌词、MPRIS、随机/循环、自动续播和持久队列仍未实现。
