# 酷狗 P0 接入

已实现标准版酷狗 App 扫码、设备注册、后台账号验证、私人歌单/曲目分页、流解析和单曲播放；主进程、preload、renderer 与酷狗后台进程之间的边界已接通。`probe:kugou` 的匿名端点、合成响应单元测试和合成酷狗媒体链路已通过，真实账号登录、歌单与部分曲目出声此前已由用户确认；2026-10-26 又收到部分歌曲与官方可用性相反、非会员播放不限时的反馈，仍不能认定权限行为与官方一致。范围见 [验证记录](validation/2026-10-26-kugou.md)。

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
| `gateway.kugou.com/v2/get_res_privilege/lite` | 只在身份冲突时核对原 hash 与同曲不同编码的关系 |

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

凭据、设备 `dfid`、二维码 key 和原始响应只在专用 Electron utilityProcess 内解密使用；主进程只在用户启用“记住登录”且系统密钥后端安全可用时保存加密 bundle，不写明文、不输出日志、不进入页面存储。未启用或后端不可用时退出即丢弃，重启后需要重新扫码；启用后恢复也要重新请求账号接口验证。当前没有 Token 自动刷新；轮询与业务请求的取消、退出和后台崩溃均通过会话 generation 丢弃旧结果。

## 歌单与播放

登录后读取私人歌单：`v7/get_all_list` 按页请求，兼容 `collect`、`love`、`self`、`list` 分组。歌单 ID 与类型只用于后续登记查询；页面和主进程只能传本次账号已读取的 ID，不能传任意 URL 或平台参数。

打开歌单时请求 `v4/get_list_all_file_v3`，请求与翻页共同使用契约中的每页 300 条，避免请求 50 条却按 300 条计算而漏歌。曲目以 32 位十六进制 `hash` 作为页面可见 ID；后台只保留该 hash 与展示元数据用于取链。云歌单的 `album_id`/`album_audio_id`/`audio_id` 可能与主 hash 错配，不参与取链，也不暴露给页面。平台数字 ID 在安全数值范围内转为 string，超出安全整数时保留原始十进制文本。部分云歌单响应不返回总数，或把时长/数量作为十进制字符串返回；后台接受这两种形式，并以本页实际条数判断是否还有下一页。单条无法安全解析的记录会被跳过，但整页没有可用曲目时仍报错，不伪造空歌单。

选择曲目后通过 `v5/url` 请求 128kbps 资源，只按主 hash 解析（`album_id`/`album_audio_id` 固定 0）。这是为了避免歌单侧 ID 与 hash 错配时，平台按错误 ID 返回另一首歌。只接受 HTTPS 的已核实媒体主机；历史 HTTP 链接只尝试同主机 HTTPS，不向 HTTP 降级。展示平台实际返回的 `extName`/`bitRate`，无法确认时保持 unknown。

完整请求默认 `IsFreePart=0`，始终携带当前标准版 App 会话，不混用概念版或网页会话。完整资源要求返回 `hash` 或 `std_hash` 对应登记 hash；即便 hash 一致，完整曲名明确冲突也拒绝。歌单文件名前缀与歌手艺名/本名的格式差异不再单独否决已确认 hash。时长接近、同一歌手、部分词语相似不再被用作身份依据；已匹配 hash 时也不以云歌单旧时长单独否决。同曲另一编码除 `std_hash` 外，也可由同一 App 会话查询资源详情确认：按原 hash 精确找到唯一资源，只接受该资源 `relate_goods[].hash` 和明确的 Ogg 编码字段；同时核对完整曲名，不按返回数组位置、同名搜索或时长猜测。只在初次身份校验失败时补查一次，不缓存跨账号关系；迟到结果按会话与解析序号丢弃。

`is_full_audio` 明确为 1/true 时按完整资源处理，非 0 的 `priv_status` 不能覆盖这一明确结果。明确为 0/false、存在正试听边界或 `priv_status` 非 0 时要求有效的 `free_part_start` / `free_part_end`；资源总时长 `timeLength` 不是试听授权，不能用它或默认 30 秒补出试听权限。普通完整请求的 `priv_status=0` 且无试听限制可正常播放；缺少明确权限信息时返回 `playback-access-unknown`。界面分别显示“完整播放”与“试听”，不据此宣称账号有会员。

完整请求不可用、无权限或权限未确认时只回退一次 `IsFreePart=1`。该端点的非空 URL 不等于完整授权：需要有效试听边界；如果明确返回完整授权，仍须 hash 对应。试听文件转码成另一 hash 时，还要求完整曲名和歌手前缀都匹配。身份冲突不再触发更宽松的试听回退。mpv 只播放已确认的试听长度，缺失边界则停止并显示原因。

`status=2/3`、`35104` 或没有播放地址只说明本次资源解析不可用，不能直接推断为会员不足、歌曲下架或全部渠道不可播。免费/会员、标准版/概念版、音质与具体版本的差异仍需真实登录态对照。最新排查见 [资源与权限验证](validation/2026-10-26-kugou-resource-access.md) 和 [编码误拒修复](validation/2026-10-26-kugou-encoding.md)。

选择酷狗曲目会追加到统一队列并切换播放，也可加入下一首；多选会保持所选列表顺序，到播放时才解析资源，不自动把整张平台歌单加入队列。播放位置、暂停、音量和错误继续使用唯一播放器状态源，切歌与退出不会遗留重复 mpv 进程。

## 媒体网关

签名资源地址只在后台流转，mpv 读取带随机令牌的 loopback 网关，不在命令行或页面出现。网关按平台隔离：酷狗只允许上述五个媒体主机，网易云只允许 `.music.126.net`；跨平台重定向会被拒绝。每次跳转重新校验，最多三次，保留 TLS 证书验证；DNS 拒绝环回、普通私网和链路本地目标，兼容 Fake-IP 代理映射。

只转发音频 Accept 与经校验的单 Range，不向 CDN 转发 Cookie、Authorization 或本机身份头，也不把上游 Set-Cookie 返回给 mpv。网关随切歌、停止、退出和登录失效关闭。

## 开发验证

- `pnpm probe:kugou`：显式匿名联网，验证设备注册、二维码挑战和“等待扫码”端点；只打印固定基线和通过状态，不输出设备标识、key、二维码或响应原文，不登录账号。
- `pnpm test`：合成响应验证 IPC 参数、扫码/确认/账号状态、身份不一致、过期、SSA、旧响应丢弃、歌单/曲目视图隔离、大页/字符串字段容错、流主机、试听边界、`is_full_audio`、完整 hash/编码关系、文件名前缀兼容、权限缺失、真实试听边界、迟到关系请求和 301 首实际分页。
- `pnpm test:playback`：实际 mpv 经 loopback 网关解码合成酷狗资源，验证平台隔离、试听上限和清理。
- `pnpm test:e2e`：真实启动酷狗 utilityProcess，验证匿名状态、窄桥接和本地退出；不自动生成真实二维码。
- `STARSMUSIC_DEBUG=1 pnpm dev`：仅在显式调试时输出酷狗媒体主机、取链字段名、hash 前缀、时长和权限字段；不输出完整签名 URL、Token、账号标识或歌曲名。

真实账号验证必须在官方 App 内由用户完成，不在 CI 自动登录。真实歌单字段、Token 作用域、不同曲目权限、实际媒体主机、链接过期和免费/会员/试听/不可用矩阵仍待补测。

## 未完成

- 用户反馈的《给你呀》与《错位时空》在本人歌单中的具体 hash、登录态和官方可用性对照。
- Token 有效期、`login_by_token` 刷新及云歌单/取链遇到 20017/20018 时的恢复策略。
- 官方网页登录渠道的独立验证；当前不实现，也不混用网页 Cookie。
- 重启恢复与系统密钥持久化。
- 歌单数量、字段类型和分页上限的真实响应矩阵；当前合成用例不替代平台实测。
- 发行包、X11/Wayland 与桌面音频矩阵。
