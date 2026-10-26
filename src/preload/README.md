# Preload

计划通过 contextBridge 暴露具体、类型化的白名单方法。不得向界面暴露 ipcRenderer、Node、凭据或任意文件/网络操作。

index.ts 暴露 window.starsMusic.getAppInfo() 和 playback 的具体方法：读取状态、原生文件选择、按登记 ID 切歌、播放/暂停/停止、定位、音量、订阅状态。订阅不传出事件对象，并返回移除监听器的函数；所有响应/事件经过运行时校验。内部调用器不向页面开放，页面不能指定通道或 mpv 命令。构建为单个 index.cjs；边界见 [根规则](../../AGENTS.md)。
