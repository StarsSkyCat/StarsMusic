# Preload

计划通过 contextBridge 暴露具体、类型化的白名单方法。不得向界面暴露 ipcRenderer、Node、凭据或任意文件/网络操作。

index.ts 当前仅暴露 window.starsMusic.getAppInfo()，不接受通道名或参数；后台响应经过运行时校验。构建为单个 index.cjs，供沙箱 preload 加载。边界见 [根规则](../../AGENTS.md)。
