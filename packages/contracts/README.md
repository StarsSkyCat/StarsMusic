# 公共契约

src/desktop.ts 定义桌面信息 IPC。src/music.ts 定义 TrackRef、ProviderContext、登录/会话状态、后台 StreamResolution 及运行时校验；src/errors.ts 定义安全错误分类，src/validation.ts 提供基础校验。平台 ID 始终使用 string，未知字段不透传。

src/playback.ts 定义本地播放白名单、有限数值参数、无路径的 PlaybackSnapshot 和事件订阅 API。播放进度以秒为单位，独立于 StreamResolution 试听字段的毫秒单位。

使用边界、单位、缓存分区与未来接入责任见 [公共契约说明](../../docs/contracts.md)。StreamResolution 含敏感媒体地址和请求头，仅限可信后台，不得作为 UI DTO。

不依赖 Electron、Vue 或具体平台 SDK。当前由根包的 typecheck/build 编译，不创建空的独立包配置。
