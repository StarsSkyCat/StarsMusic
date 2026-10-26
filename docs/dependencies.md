# 当前依赖记录

P0 桌面基础直接依赖如下，版本固定于 package.json，完整依赖树及校验值由 pnpm-lock.yaml 记录。来源为 npm 官方注册表与对应官方项目，未复制参考播放器代码或视觉资产。

| 依赖 | 版本 | 用途 | 许可 |
| --- | --- | --- | --- |
| vue | 3.5.44 | 实际桌面页面与响应式状态 | MIT |
| electron | 45.0.0 | 桌面运行时、窗口、沙箱与 IPC | MIT |
| electron-vite | 6.0.0 | main / preload / renderer 开发与构建 | MIT |
| vite | 8.3.5 | 开发服务器与打包 | MIT |
| @vitejs/plugin-vue | 6.0.10 | Vue 单文件组件编译 | MIT |
| typescript | 5.9.3 | 严格类型检查；与本次构建工具及 vue-tsc 一起验证 | Apache-2.0 |
| vue-tsc | 3.3.13 | Vue 模板与 TypeScript 检查 | MIT |
| @types/node | 24.19.2 | 与 Node 24 开发基线一致的类型 | MIT |
| @playwright/test | 1.64.1 | 实际 Electron 启动、桥接与生命周期冒烟 | Apache-2.0 |

只将 Vue 列为应用依赖，其余为开发依赖。mpv、SQLite、平台 API、Pinia、Router 和打包器未使用，因此未安装。

## 安装行为

本次依赖树未要求依赖生命周期构建脚本，onlyBuiltDependencies 保持为空。Electron 45 包提供显式 install-electron 工具；pnpm setup:electron 调用该工具，下载固定版本的官方平台二进制并使用包内 checksums.json 校验，再由 @electron-internal/extract-zip 解压到 node_modules。此命令需要网络和缓存写入，不修改系统沙箱、不以 root 启动、不使用 --no-sandbox。

Rolldown、Electron ZIP 解压器等传递依赖包含平台预编译原生包，当前只在本次 Linux x86_64 环境验证。锁文件不替代原生包的发行兼容性和完整第三方许可审计；Electron/Chromium 的附带许可在正式分发时仍需纳入清单。

## 官方参考

- [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)
- [electron-vite 开发指南](https://electron-vite.org/guide/dev)
- [Playwright Electron](https://playwright.dev/docs/api/class-electron)：自动化 API 仍标为实验性。
