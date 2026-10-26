# P0 桌面基础验证

## 基本信息

- 日期、执行者：2026-10-26，Codex 本地开发会话。
- 目标：P0 第一步，最小安全桌面窗口与实际 IPC 闭环。
- 结果：通过本次桌面基础检查；发行兼容性与完整 P0 尚未验证。
- 工作区：基于 de5a7bb 的未提交改动；本记录不代表正式发布。
- 系统：Arch Linux rolling，Linux x86_64，当前会话提供 Wayland 与 XWayland；运行于受限开发环境，不能代表发行版矩阵。
- Node.js 24.22.1、pnpm 10.34.9；Electron 45.0.0，内置 Chromium 156.0.8078.48、Node.js 24.22.0。
- 登录、音频服务、mpv：不涉及，未验证。

## 实现与操作

1. 冻结锁文件安装依赖，运行 setup:electron 下载固定运行时。
2. typecheck 检查主进程、preload、Vue 和测试源码；test 执行 IPC 边界测试。
3. build 生成 main ESM、单文件 CommonJS preload 与本地 renderer。
4. test:e2e 实际启动构建产物，读取名称、版本、平台及运行时版本，点击“重新检查”再次读取。
5. 检查页面无 require、process、ipcRenderer；桥接只有 getAppInfo；业务 session 不持久化；Linux renderer 的 Seccomp=2、NoNewPrivs=1。
6. 验证新窗口被拒绝、主文档导航被阻断；以 1280×800 和 960×640 视口检查页面，最小视口可滚动访问桌面信息。
7. 关闭业务窗口，等待 Electron 退出，清理测试临时配置目录。

## 实际结果

- 冻结安装、类型检查、三个单元测试、应用构建及一个完整桌面冒烟场景通过。
- getAppInfo 返回实际 Electron 主进程数据，未使用模拟平台、模拟账号或模拟曲目。
- 已查看本地默认视口与最小视口截图，页面无内容横向截断；截图位于 Git 忽略的 artifacts/，不作为在线账号验证证据。
- E2E 显式启用 chromiumSandbox，最终默认图形会话测试未传入 --no-sandbox、--disable-gpu 或显示协议覆盖参数。另曾在 X11 模式通过一次冒烟，但不构成独立 X11 桌面验收。
- dev 命令已实际启动 Vite 127.0.0.1:5173 与 Electron，start 已实际启动构建产物，检查后用 Ctrl+C 停止；开发命令未单独执行完整 UI 自动化。
- 受限环境输出 DRM/GPU、NSS、D-Bus 警告，GPU 子进程曾退出并重启；页面与 IPC 冒烟通过，不据此宣称硬件加速或桌面服务兼容性通过。

## 负向检查与限制

- 单元测试确认其他窗口、子帧、不同文档 URL、空来源与额外参数被拒绝，开发地址限制精确 loopback 文档。
- 响应字段缺失、错误类型和空字段会失败；额外字段不向界面透传。
- 最初桌面测试超时定位为 Playwright 等待已被 Electron 拦截的导航；改为检查原文档并单独验证退出后通过，未为通过测试关闭应用沙箱。
- Wayland 合成器可能忽略原生 setSize，因此通过显式设置渲染视口检查布局；不宣称原生窗口管理行为已覆盖所有合成器。
- 登录、导入、播放、凭据、平台请求取消、SQLite、MPRIS、安装包、Windows/macOS 均未执行。
- CI 已配置安装、类型检查、单元测试和构建，尚未观察远端 CI 运行结果。

## 后续

桌面基础可继续承载 P0 第二步：TrackRef、ProviderContext、登录状态、流解析、错误分类与会话 generation；之后再实现 mpv 本地播放。完整 P0 门槛仍未达到。
