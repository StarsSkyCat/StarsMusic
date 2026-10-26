# 两个参考项目的播放接入对照

核对日期：2026-10-26。只读取源码，没有运行两个参考应用，也没有验证它们在当前平台及用户账号下的真实可用性。此文用于当前酷狗错曲/误拒排查，不代表采用参考项目的代码、依赖或资产。

## YesPlayMusic：网易云

本次固定提交 [5d5fa23](https://github.com/qier222/YesPlayMusic/tree/5d5fa23b7429c82a9932bbc2c9f6036403c5757b)。

- [track.js](https://github.com/qier222/YesPlayMusic/blob/5d5fa23b7429c82a9932bbc2c9f6036403c5757b/src/api/track.js) 使用网易云歌曲 ID 请求歌曲详情与播放地址，按用户音质选择码率。
- [common.js](https://github.com/qier222/YesPlayMusic/blob/5d5fa23b7429c82a9932bbc2c9f6036403c5757b/src/utils/common.js) 按 ID 关联权限，考虑可播放码率、云盘、会员、付费专辑和版权；展示层并非用歌单行号对应歌曲。
- [auth.js](https://github.com/qier222/YesPlayMusic/blob/5d5fa23b7429c82a9932bbc2c9f6036403c5757b/src/api/auth.js) 包括扫码、确认轮询与登录刷新。它不是当前酷狗接口的实现来源。

## Mineradio-paused：含酷狗

本次固定提交 [d43de56](https://github.com/XxHuberrr/Mineradio-paused/tree/d43de565acabfdc1a9c9820a27e81a98ccbebcef)。

[kugou-api.js](https://github.com/XxHuberrr/Mineradio-paused/blob/d43de565acabfdc1a9c9820a27e81a98ccbebcef/kugou-api.js) 中，歌单映射保留原 hash、不同音质 hash、专辑/专辑音频标识，清理文件名展示；取链准备多个音质候选和多条官方请求路径，并单独归一化会员及试听信号，带有有限尝试预算。

[desktop/main.js](https://github.com/XxHuberrr/Mineradio-paused/blob/d43de565acabfdc1a9c9820a27e81a98ccbebcef/desktop/main.js) 使用独立持久网页 session 打开官方登录页并读取网页 Cookie。StarsMusic 当前为标准版 App 扫码：渠道、身份绑定和权限作用域不同，不能据参考网页登录代码推断本项目 App Token 应能取得同样资源。

## 对当前修复的影响

- 酷狗 hash 是具体编码资源标识，同曲不同音质可能不同；“返回 hash 变化就一定错歌”过于严格。StarsMusic 通过已有协议基线中的资源详情端点按原 hash 精确核对同曲编码，补足明确映射，而非以时长或模糊歌名放行。
- 歌单文件名可带歌手、扩展名与别名。已确认资源身份后，完整曲名相同的歌手前缀格式差异不再导致误拒；真正不同曲名仍拒绝。
- 保留后台会话隔离与严格媒体主机校验。没有增加网页登录、多渠道自动回退或会员等级探测；这些需要独立验证。参考应用的源码不能证明其全部歌曲实际可播放。

## 许可与复用边界

YesPlayMusic 的 [LICENSE](https://github.com/qier222/YesPlayMusic/blob/5d5fa23b7429c82a9932bbc2c9f6036403c5757b/LICENSE) 为 MIT，README 的附加说明也已查看。Mineradio 的 package.json 为 GPL-3.0-only，仓库 [LICENSE](https://github.com/XxHuberrr/Mineradio-paused/blob/d43de565acabfdc1a9c9820a27e81a98ccbebcef/LICENSE) 为 GPLv3，README 单独声明名称、Logo 与原创视觉权益。

本轮没有复制这两个参考播放器的源码或素材，没有安装其旧依赖；资源端点仍按本项目既有 MIT 协议基线独立实现，见 [第三方说明](../THIRD_PARTY_NOTICES.md)。

## 本轮歌词、封面和登录保存

补充核对同一固定提交的 YesPlayMusic `src/api/track.js` 歌词入口与 Mineradio `kugou-api.js` 的歌词搜索/下载流程：网易云按歌曲 ID 关联详情/歌词，酷狗按 hash 查候选后通过歌词 ID/accesskey 下载。StarsMusic 据平台响应格式独立实现行级 LRC 解析、当前曲目投影和受限图片获取；没有复制这两个播放器的实现、歌词缓存、视觉或资产。协议端点字段同时核对已有 MIT API 基线的 `lyric.js`/`search_lyric.js`。

参考项目的网页 Cookie/session 保存方式不能直接复用于本项目 App Token；继续使用现有系统密钥保险库，并补上退出/关闭记住期间的迟到加密写入保护。没有安全系统密钥后端时保持临时会话。实际范围见 [歌词与封面验证](validation/2026-10-26-presentation.md) 与 [凭据说明](credentials.md)。
