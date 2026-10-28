# 安全与本地数据

报告安全问题请先阅读 [SECURITY.md](../SECURITY.md)。不要在公开 Issue、PR 或聊天中粘贴真实 Cookie、Token、密码、二维码、手机号、签名播放地址或个人歌单截图。

## 本地数据

运行时数据位于 Electron 的 userData 目录，具体位置由操作系统决定，不在源码目录中。新构建的 Windows EXE 与 Arch 包在正式卸载时自动清除默认应用数据（登录密文、密钥、队列、偏好和缓存），升级保留数据；原有安装包不会追溯获得此行为。卸载不删除导入的音乐原文件。

| 文件 | 内容与保护边界 |
| --- | --- |
| credentials.sqlite | 用户选择记住登录后保存的 AES-256-GCM 密文；账号、昵称和设备字段位于密文内 |
| keys/login.key | 独立保存的随机 32 字节本地密钥，不依赖系统密钥服务 |
| playback.sqlite | 未加密的队列、本地路径、平台账号关联、进度、音量与静音，不含平台 Token 或签名资源地址 |
| appearance.json / desktop.json | 白名单外观和桌面偏好 |

**同时取得登录密钥与数据库即可解密登录凭据。** 此方案不提供系统密钥库级隔离，也不抵御同用户恶意程序或整个数据目录泄漏。Linux 使用目录 0700、文件 0600；Windows 依赖用户目录的 NTFS ACL。

记住登录按平台选择，默认关闭；存储或密钥不可用时保留临时会话并提示。启动恢复需重新验证平台账号，保存不延长 Token 有效期。退出平台或关闭记住登录删除对应保存项；界面不再提供单独清除保存的入口，账号信息、扫码记住登录与退出操作集中在对应平台标题右侧的账号面板。删除不能保证物理介质、备份与外部副本同步擦除。

已有密文但密钥丢失时不自动替换；损坏或未知数据库版本保留原库并报告。旧加密 JSON 只有在可解密且新库尚未初始化时才事务导入，提交后删除旧文件，不采用明文回退。

Arch 卸载钩子以普通账号自身权限清理 `~/.config/StarsMusic` 和 `~/.cache/StarsMusic`，不会以 root 递归删除主目录数据；跳过重定向的配置/缓存根目录。自定义 XDG 路径、`--user-data-dir`、其他副本及备份不在自动清理范围，具体见 [打包说明](../packaging/README.md)。

## 进程与 IPC

BrowserWindow 启用 sandbox、contextIsolation，关闭 Node 集成和 webview，使用内存 session；拒绝权限、下载、导航和新窗口，CSP 限制资源与连接。preload 仅暴露具体业务白名单，主进程再次验证调用窗口、主帧、精确文档及参数。

renderer 不接触凭据、任意文件读写、SQL、进程或通用请求。平台请求运行于各自 utilityProcess，SQLite 同步操作运行于 Node worker；utilityProcess 并不是权限沙箱。响应和错误只投影白名单字段及固定本地分类，不转发原始异常或平台返回。

平台、账号、客户端渠道分别隔离。登录、退出与切账号推进会话 generation，切歌用独立播放 generation，旧响应与事件不能写回新状态。

## 网络与音频

mpv 用参数数组和 shell=false 启动，Linux 私有 FD / Windows 随机命名管道控制，不开放 TCP 命令接口。禁用用户配置、脚本、旁加载和间接文件引用，切歌等待旧实例退出并清理旧请求头，退出回收子进程。

音频经随机令牌保护的 127.0.0.1 网关，只支持 GET / HEAD 和受限单 Range，逐跳检查且最多三次重定向。网易云限 .music.126.net；酷狗限已核验的 fs-open、fsandroid、fsmobile 主机及对应 tx 主机，不放行整个平台域名。来源以 packages/contracts/src/media-policy.ts 为准。

DNS 拒绝环回、普通私网与链路本地目标，兼容 198.18.0.0/15 Fake-IP 代理；TLS 按原始 CDN 域名验证，不关闭证书校验。不转发 Cookie、Authorization 或上游 Set-Cookie，签名源地址不进入页面、mpv 命令行或持久日志。封面仅允许已核验平台图片主机、受限大小和实际格式，不接受 SVG。

仅显式设置 STARSMUSIC_DEBUG=1 时输出受限酷狗诊断字段；不输出完整签名 URL、Token、账号或曲名。共享日志前仍应人工检查。

## 仓库与分发

忽略规则覆盖数据库、密钥、账号导出、HAR、运行日志、profile、构建和测试截图，提交前仍需检查暂存区。首次公开源码还应检查可达提交历史，删除当前文件不能消除旧提交中的敏感数据。测试使用明确标识的合成账号，不保存真实登录响应。

依赖与参考代码须记录来源、版本和许可；源码 MIT 不替代 mpv、FFmpeg、Electron / Chromium 等组件自己的许可。发行材料见 [第三方声明](../THIRD_PARTY_NOTICES.md)、[依赖清单](dependencies.md) 和 [打包说明](../packaging/README.md)。
