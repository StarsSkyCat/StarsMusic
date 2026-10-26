# 主进程

计划负责 Electron 启动、窗口生命周期、授权窗口、凭据服务和受限 IPC 调度。重型扫描、平台调用和同步数据库操作放在对应后台服务。

index.ts 已实现安全 BrowserWindow、内存 session、权限/下载/导航/弹窗拒绝、应用信息 IPC 与关闭退出。ipc-policy.ts 校验调用窗口、主帧、精确文档与空参数。后续服务按 [P0 路线图](../../docs/roadmap.md) 接入。
