# 酷狗 P0 接入

已实现标准版酷狗 App 扫码、设备注册、后台账号验证、私人歌单/曲目分页、流解析和单曲播放；主进程、preload、renderer 与酷狗后台进程之间的边界已接通。`probe:kugou` 的匿名端点、合成响应单元测试和合成酷狗媒体链路已通过，但**真实账号的扫码、歌单读取和实际出声尚未由用户验证**。范围见 [验证记录](validation/2026-10-26-kugou.md)。

## 渠道与协议基线

首版选择 `kugou-app` 扫码通道，不实现官方网页登录窗口。App 扫码一次返回 `userid` 与 `token`，避免在隔离窗口中提取网页 Cookie 后再猜测其能否调用 App 接口；网页 Cookie 与 App Token 不能混用。网页渠道保留为后续独立验证项，本轮不宣称已评估完成。

协议基线固定为 [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi/tree/62730f900dc9fdc51396a663b3d33a6c4c704046) 1.6.2，源码提交 `62730f900dc9fdc51396a663b3d33a6c4c704046`。只以 Node.js `crypto`/`fetch` 重新实现所需端点，不安装或加载完整 API SDK，不启动公开 HTTP 服务，不引入任意请求或设备信息采集接口。协议常量、签名格式和公开 RSA 公钥属于公开接口格式，不是用户凭据；来源与 MIT 声明见 [第三方记录](../THIRD_PARTY_NOTICES.md)。

固定端点与用途：

| 端点 | 用途 |
| --- | --- |
| `userservice.kugou.com/risk/v3/r_register_dev` | 注册临时设备，取得 `dfid` |
| `login-user.kugou.com/v2/qrcode` | 获取扫码挑战 key |
| `login-user.kugou.com/v2/get_userinfo_qrcode` | 轮询扫码状态；状态 4 返回 `userid`/`token` |
| `gateway.kugou.com/v3/get_my_info` | 验证账号并读取昵称 |
| `gateway.kugou.com/v7/get_all_list` | 私人歌单分页 |
| `gateway.kugou.com/v4/get_list_all_file_v3` | 歌单曲目分页 |
| `gateway.kugou.com/v5/url` | 按已登记曲目解析播放资源 |

实际媒体主机只允许 `fs-open.kugou.com`、`fsandroid.kugou.com`、`fsandroid.tx.kugou.com`、`fsmobile.kugou.com`、`fsmobile.tx.kugou.com`；不是放行整个 `kugou.com`。`fs-open` 来自公开客户端实测记录，仍需本次真实取链确认；新增渠道或 CDN 必须补充实测证据。

## 登录与会话

点击“连接酷狗”后，后台先生成随机的进程内 GUID 与十进制 MID，调用设备注册换取 `dfid`，再获取二维码 key。二维码内容固定为官方 App 登录链：

```text
https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=<key>
```

页面只收到内存中的 PNG 数据 URL、状态、昵称、歌单和曲目白名单字段。二维码有效期三分钟，每两秒轮询；网络或限流错误退避到十秒。状态按平台含义处理：

- 0：二维码过期，清理临时状态并要求重新获取。
- 1：等待扫码。
- 2：已扫码，等待 App 内确认。
- 4：授权完成，响应携带 `userid` 与 `token`；仍需账号接口验证后才能进入 connected。

“已扫码”或“收到 token”都不是登录完成。后台先检查 `userid`/`token` 格式，保存到后台传输对象，再请求 `get_my_info`；若响应回显账号 ID，必须与扫码身份一致，昵称必须存在。任一校验失败都清理临时凭据并显示明确诊断，不把部分授权当作成功。SSA 安全验证响应头统一归类为 `verification-required`，提示用户先在官方 App 处理，不尝试绕过验证码。

凭据、设备 `dfid`、二维码 key 和原始响应只存在于专用 Electron utilityProcess 内存；不写文件、不输出日志、不进入页面存储。退出应用即丢弃，重启后需要重新扫码。当前没有系统密钥持久化、记住登录或 Token 自动刷新；轮询与业务请求的取消、退出和后台崩溃均通过会话 generation 丢弃旧结果。

## 歌单与播放

登录后读取私人歌单：`v7/get_all_list` 按页请求，兼容 `collect`、`love`、`self`、`list` 分组。歌单 ID 与类型只用于后续登记查询；页面和主进程只能传本次账号已读取的 ID，不能传任意 URL 或平台参数。

打开歌单时请求 `v4/get_list_all_file_v3`，每批最多 300 条。曲目以 32 位十六进制 `hash` 作为页面可见 ID；后台同时保存 `album_id`、`album_audio_id`/`audio_id`，这些参数不暴露给页面。平台数字 ID 在安全数值范围内转为 string，超出安全整数时保留原始十进制文本。部分云歌单响应不返回总数，或把时长/数量作为十进制字符串返回；后台接受这两种形式，并以本页实际条数判断是否还有下一页。单条无法安全解析的记录会被跳过，但整页没有可用曲目时仍报错，不伪造空歌单。

选择曲目后通过 `v5/url` 请求 128kbps 资源。只接受 HTTPS 的已核实媒体主机；历史 HTTP 链接只尝试同主机 HTTPS，不向 HTTP 降级。展示平台实际返回的 `extName`/`bitRate`，无法确认时保持 unknown。

权限按平台实际响应判断：`priv_status` 为 0 视为普通返回；非 0 时只有 `is_full_audio` 明确为 1/true 才视为完整音频，否则必须取得合法的试听起止边界，缺失边界时拒绝播放，不由“账号已登录”推断完整权限。试听会标记并限制 mpv 播放长度。

取链返回的 `hash`/`std_hash` 与登记 hash 不一致时，只有平台返回时长（`timeLength`，秒）与登记时长相差不超过 10 秒，才按同曲目的另一编码接受；否则拒绝播放，避免把其他音频显示成当前曲目。部分曲目返回 `status=0`/`error_code=35104` 等平台限制，统一归类为不可用或权限错误，不自动换源、不猜测会员状态。

选择酷狗曲目会替换当前临时播放队列，只播放单曲；不自动把整张平台歌单加入队列。播放位置、暂停、音量和错误继续使用唯一播放器状态源，切歌与退出不会遗留重复 mpv 进程。

## 媒体网关

签名资源地址只在后台流转，mpv 读取带随机令牌的 loopback 网关，不在命令行或页面出现。网关按平台隔离：酷狗只允许上述五个媒体主机，网易云只允许 `.music.126.net`；跨平台重定向会被拒绝。每次跳转重新校验，最多三次，保留 TLS 证书验证；DNS 拒绝环回、普通私网和链路本地目标，兼容 Fake-IP 代理映射。

只转发音频 Accept 与经校验的单 Range，不向 CDN 转发 Cookie、Authorization 或本机身份头，也不把上游 Set-Cookie 返回给 mpv。网关随切歌、停止、退出和登录失效关闭。

## 开发验证

- `pnpm probe:kugou`：显式匿名联网，验证设备注册、二维码挑战和“等待扫码”端点；只打印固定基线和通过状态，不输出设备标识、key、二维码或响应原文，不登录账号。
- `pnpm test`：合成响应验证 IPC 参数、扫码/确认/账号状态、身份不一致、过期、SSA、旧响应丢弃、歌单/曲目视图隔离、大页/字符串字段容错、流主机、试听边界、`is_full_audio`、返回 hash/时长一致性。
- `pnpm test:playback`：实际 mpv 经 loopback 网关解码合成酷狗资源，验证平台隔离、试听上限和清理。
- `pnpm test:e2e`：真实启动酷狗 utilityProcess，验证匿名状态、窄桥接和本地退出；不自动生成真实二维码。
- `STARSMUSIC_DEBUG=1 pnpm dev`：仅在显式调试时输出酷狗媒体主机、取链字段名、hash 前缀、时长和权限字段；不输出完整签名 URL、Token、账号标识或歌曲名。

真实账号验证必须在官方 App 内由用户完成，不在 CI 自动登录。真实歌单字段、Token 作用域、不同曲目权限、实际媒体主机、链接过期和免费/会员/试听/不可用矩阵仍待补测。

## 未完成

- 真实账号扫码 → 昵称 → 私人歌单 → 曲目 → 实际出声的完整闭环。
- Token 有效期、`login_by_token` 刷新及云歌单/取链遇到 20017/20018 时的恢复策略。
- 官方网页登录渠道的独立验证；当前不实现，也不混用网页 Cookie。
- 重启恢复与系统密钥持久化。
- 歌单数量、字段类型和分页上限的真实响应矩阵；当前合成用例不替代平台实测。
- 发行包、X11/Wayland 与桌面音频矩阵。
