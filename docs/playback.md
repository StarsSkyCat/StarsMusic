# 本地播放基础

P0 第三步在 Linux 实现系统 mpv 本地音频闭环，未新增 npm 依赖。界面点“选择本地音频”，可一次选择最多 200 首音频，替换本次会话的临时队列并播放第一首。上一首、下一首、点击队列项目均显式切歌；末尾停在 ended，不自动续播。目录扫描、标签读取、循环/随机、持久队列和在线流仍待实现。

文件类型过滤包含 MP3、FLAC、WAV、M4A、AAC、Ogg、Opus、AIFF；实际解码以当前 mpv 构建为准。本轮实际音频样本为生成的 PCM WAV，不能据此宣称其他格式与发行版均已验证。缺失 mpv、文件不可访问、解码或音频输出失败显示明确错误；不自动切换到其他播放内核或静音输出。

## 模块与通信

- packages/playback/src/local-player.ts 拥有临时队列、路径映射、独立 generation、revision 和唯一 PlaybackSnapshot。UI 只投影后台状态，进度、暂停、结束均由实际 mpv 事件更新。
- packages/playback/src/mpv-client.ts 使用 spawn 参数数组、shell=false 与继承 FD 3（input-ipc-client）通信。没有监听 socket/端口，没有临时 socket 文件；每个请求使用 request_id 与三秒超时，未知错误不透传原始 mpv 文本。
- src/main 只协调原生选择器、来源/参数校验、状态发布与退出。仅后端接触真实路径；文件异步 realpath/stat，确认是普通文件后传给 mpv。
- preload 暴露具体 playback 方法，不能指定 IPC 通道、文件路径、URL 或 mpv 命令。队列 ID 每次选择重新生成；UI 不能借 ID 请求未登记的文件。

PlaybackSnapshot 包含状态、队列 ID/标题、当前索引、秒数位置/时长、0–100 音量、mpv 版本、实际音频输出驱动及安全错误，不含路径。renderer 先订阅再读取快照，按 revision 丢弃晚到旧响应；订阅在卸载时解除。

## 切歌与退出

每次切歌立即推进 playback generation；所有异步文件检查、进程事件和错误都检查所属 generation。串行切换先关闭旧进程并等待退出，再创建新进程，避免重复声音；过时的排队切换不启动新进程。为了让无 ID 的 mpv 属性事件也有明确归属，本阶段每首重建 mpv，代价是切歌存在初始化延迟，暂不支持无缝播放。

启动时禁用用户配置、脚本、视频窗口、外部字幕/音轨旁加载和间接文件引用，lavf 协议只允许 file。新进程 loadfile 前清空 http-header-fields；实际有凭据的在线请求头与重定向隔离仍需未来独立验证。

停止和退出都会先使旧 generation 失效，再关闭 IPC。mpv 在继承客户端 FD 关闭后退出；超过 500ms 依次发送 TERM，再过 500ms 发送 KILL，并等待进程关闭。Electron before-quit 等待服务清理后再退出。进程异常终止显示错误，用户可以点击播放显式重建，不自动无限重启。应用音量设置在切歌时保留，不被新实例的默认音量覆盖。

## 验证

pnpm test:playback 使用真实 mpv、null 输出与现场生成 WAV；pnpm test:e2e 使用实际 Electron/mpv 和默认系统音频输出，只替代原生文件选择器交互。null 输出只在测试构造参数中显式启用，产品无相关开发开关。详细结果见 [P0 记录](validation/2026-10-26-local-playback.md)。

API 行为参考 [mpv 官方手册](https://mpv.io/manual/stable/) 的 JSON IPC、input-ipc-client、loadfile、access-references 与 current-ao。
