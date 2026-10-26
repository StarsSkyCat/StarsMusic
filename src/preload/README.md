# Preload

计划通过 contextBridge 暴露具体、类型化的白名单方法。不得向界面暴露 ipcRenderer、Node、凭据或任意文件/网络操作。

index.ts 暴露 window.starsMusic.getAppInfo() 和 playback 的具体方法：读取状态、原生文件选择、按登记 ID 切歌、播放/暂停/停止、定位、音量、订阅状态。订阅不传出事件对象，并返回移除监听器的函数；所有响应/事件经过运行时校验。内部调用器不向页面开放，页面不能指定通道或 mpv 命令。构建为单个 index.cjs；边界见 [根规则](../../AGENTS.md)。

netease 与 kugou 各自只暴露读状态、扫码/取消/本地退出、读取歌单/曲目、按已登记 ID 播放和订阅。没有通用 request、resolveTrack、凭据导入或媒体 URL 方法；公开投影不包含 Cookie/Token 或平台原始响应。

credentials 只暴露 getStatus、setRemember、clear 和 onChanged；不暴露密文、账号 ID、昵称或文件路径。

appearance 仅暴露 getPreference() / setPreference(system | light | dark)，请求和响应都校验枚举；不暴露任意设置、文件路径或文件读写。

netease.browse 只接受热歌、分类歌单、歌曲/歌单搜索及已登记公开歌单详情的领域联合参数；同时检查关键词、分类、偏移与 ID，不接受端点、Cookie、媒体 URL 或任意请求头。
