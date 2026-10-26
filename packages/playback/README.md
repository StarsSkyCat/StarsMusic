# 播放服务

src/local-player.ts 已实现临时本地队列和唯一播放状态源，src/mpv-client.ts 管理 Linux mpv 私有继承 FD、JSON 请求关联、事件和进程生命周期。独立 playback generation 隔离切歌事件；旧进程退出后才启动新进程，停止/应用退出清理子进程。

已有实际 mpv 和桌面测试，范围见 [播放说明](../../docs/playback.md)。在线流、歌词、MPRIS、随机/循环、自动续播和持久队列仍未实现。
