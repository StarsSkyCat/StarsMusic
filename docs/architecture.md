# 架构说明

StarsMusic 使用 Electron + Vue 3 + TypeScript。mpv 作为独立子进程解码与输出音频，SQLite 保存登录密文和播放记录。Linux 优先，通过系统适配层支持 Windows；macOS 适配仍为规划。

## 模块边界

| 路径 | 当前职责 |
| --- | --- |
| src/main/ | 窗口、生命周期、IPC 来源与参数验证、服务和 worker 协调 |
| src/preload/ | contextBridge 具体方法白名单；单文件 CommonJS 构建 |
| src/renderer/ | Vue 页面、UI 状态、后台快照投影；不读取凭据或启动进程 |
| packages/contracts/ | 领域模型、IPC 契约、运行时校验和固定错误；不依赖 Electron / Vue / SDK |
| packages/providers/ | 网易云 / 酷狗协议、响应归一化、会话与资源解析 |
| packages/playback/ | 唯一播放器、队列、mpv IPC、媒体网关、歌词与封面投影 |
| packages/storage/ | 凭据与播放记录 SQLite 存储；音乐库索引尚未实现 |
| packages/desktop/ | 共用 Electron 桌面能力、Linux D-Bus / portal 和 Windows 适配 |
| tests/ | unit、integration 和 e2e 分层验证 |
| packaging/、scripts/ | 打包输入、依赖许可、探测与验证工具 |

这些目录由根包管理，不是独立发行的工作区包。

## 进程与数据流

renderer 只能调用 preload 的具体白名单方法，不能指定 IPC 通道、路径、URL、SQL、平台端点或 mpv 命令。主进程验证当前主窗口、主帧、精确文档 URL、参数和响应投影；订阅返回清理函数，不传出 Electron 事件对象。

网易云与酷狗分别运行在 utilityProcess，负责网络、临时凭据与平台会话。utilityProcess 用于生命周期和内存隔离，不等同权限沙箱。SQLite 同步操作在专用 Node worker 执行，窗口主进程只异步协调。主进程构建包含平台 worker、credential-store-worker 与 playback-session-worker。

外部数据先视为 unknown，再按白名单校验；平台 ID 用 string。ProviderContext 按平台、账号和客户端渠道分区。SessionGeneration 为每个平台维护当前租约，登录、退出、切账号和后台重启使旧请求与事件失效；切歌另用独立 playback generation，不能共用账号代次。

## 播放与展示

MusicPlayer 拥有唯一 PlaybackSnapshot、队列、revision 与播放代次。UI、歌词和 MPRIS 订阅同一播放源，先订阅后读取快照，并丢弃迟到结果。播放进度以秒为单位，资源试听和行级歌词时间以毫秒为单位，MPRIS 使用微秒。

本地选择器一次最多登记 200 个音频文件；主进程异步检查 realpath / stat，仅向页面返回登记 ID。在线歌曲在实际播放时解析资源，整单播放读取完整元数据后原子替换队列，队列上限为 10000 首。列表循环、单曲循环、随机三种模式互斥，随机顺序与原序随队列保存。

资源解析、权限、曲目身份校验、本地文件或解码失败时，MusicPlayer 保留错误并等待 2.5 秒，按当前队列顺序和循环模式尝试下一首；单曲循环也会跳过失败项。连续失败期间每个队列项最多尝试一次，整队不可用时停在错误状态，只有实际播放进度前进后才重置失败记录。登录失效、平台安全验证、限流或引擎不可用等错误保持停止，避免无效请求。暂停、停止、手动切歌、替换队列、退出当前平台及销毁播放器会取消待执行切歌；计时器受播放 generation 约束，候选按触发时的最新队列计算。

mpv 使用参数数组和 shell=false 启动。Linux 使用继承 FD 3，Windows 使用随机命名管道和隐藏控制台；命令 IPC 不开放网络端口。切歌先使旧代次失效，等旧进程退出才启动新实例，避免重复音频；每首重建进程，目前不支持无缝播放。退出等待 IPC、媒体网关、平台后台与 mpv 清理。

在线音频经随机令牌保护的 loopback 网关读取，源地址和请求头只在后台流转。按平台限制 CDN、DNS、TLS、重定向和 Range，不向 mpv 转发 Cookie 或 Authorization。试听长度与定位上限由后台执行。网关和凭据细节见 [安全说明](security.md)。

歌词、封面使用独立 PresentationSnapshot，按播放代次和曲目 ID 关联，读取失败不影响音频。封面仅投影校验后的有界 PNG / JPEG / WebP 内存数据；页面不获取远程图片 URL 或歌词密钥。

## 存储与恢复

- credentials.sqlite 保存 AES-256-GCM 登录密文，本地随机密钥保存在 keys/login.key；只在用户选择记住登录后保存。
- playback.sqlite 保存队列、顺序、平台账号关联、本地路径、位置、音量和静音；不加密，不保存 Token 或签名媒体地址。
- appearance.json 与 desktop.json 保存公开外观和桌面偏好，不接受任意设置键。

队列设置变化合并写入，连续播放进度每三秒保存，正常退出冲刷；异常断电可能丢失最近数秒。启动只暂停恢复，不启动音频；在线曲目需要重新连接原账号并重新解析权限。显式退出清理该平台队列，其他平台和本地曲目保留。损坏或未知数据库版本保留原库并报告错误，不能用空数据覆盖。

凭据从原系统密钥加密 JSON 迁移时，只有旧文件可解密且新库尚未初始化才执行；事务提交后再删除旧文件。当前选择本地随机密钥以减少系统服务依赖，同时明确同获密钥与数据库即可解密的保护边界。
