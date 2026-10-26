# 网易云发现与搜索

日期：2026-10-27。按用户要求增加网易云热歌、歌单和搜索，分后台与页面两步提交。基线仍为 api-enhanced 4.41.1 / 2db6684453297ee86dec0492842f2320b08182d9。

## 第一步：后台能力

- 热歌通过官方榜单列表识别「云音乐热歌榜」，再读对应歌单与曲目，不把固定曲目或假数据当热歌。
- 分类歌单支持固定分类与热门/最新排序；公开歌单详情只能读取已由平台列表登记的 ID。
- 歌曲/歌单搜索使用 cloudsearch，分别映射 type 1 / 1000；兼容歌曲 ar/dt 与 artists/duration 字段。
- 每页 30 项，偏移最多 3000，搜索词最多 100 字且拒绝控制字符；不提供任意请求端点、路径、Cookie 或媒体地址。
- 公开 catalog 与私人歌单/曲目字段分开。匿名传输与登录传输分别持有，登录、退出、切账号清空发现及登记；每个发现请求取消前一个，旧成功和旧失败均不写回。
- 已登录且登记过的发现曲目可沿用原有播放、下一首、歌词和封面；实际音频权限仍以原流解析响应为准。匿名浏览不是登录或播放成功。

字段与端点参考固定版本的 [cloudsearch.js](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/2db6684453297ee86dec0492842f2320b08182d9/module/cloudsearch.js)、[top_playlist.js](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/2db6684453297ee86dec0492842f2320b08182d9/module/top_playlist.js)、[toplist.js](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced/blob/2db6684453297ee86dec0492842f2320b08182d9/module/toplist.js) 和既有 playlist_detail / song_detail；许可已补充到第三方记录，没有引入整个 SDK 或新依赖。

## 已执行验证

- `pnpm typecheck`：后台、preload、契约及现有 Vue 类型检查。
- `pnpm test`：80 项；新增请求拒绝/投影、匿名榜单/歌单归一化与分页顺序、两类型搜索、空结果/限流、旧搜索失败丢弃、退出清空和已登录搜索曲目解析。
- `pnpm test:e2e`（含构建）：既有桌面回归，额外确认网易云仅新增 browse 方法，酷狗能力保持独立。
- `pnpm probe:netease-discovery`：显式匿名联网，热歌第 1/2 页、热门歌单、公开详情、歌曲搜索、歌单搜索均返回可校验的真实响应，每个样本返回 30 项。只输出计数与是否有后续，不输出响应、二维码、Cookie、播放地址或私人账号信息。
- `pnpm check`：文档、相对链接与配置检查。

此步骤的页面接入在下一提交完成。匿名联网与合成回归不代表已完成新入口的真实账号音频验收、完整权限矩阵或跨发行包验收；CI 不运行匿名联网探测或真实登录。
