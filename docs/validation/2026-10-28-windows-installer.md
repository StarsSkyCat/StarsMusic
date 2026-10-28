# Windows EXE 安装包验证

日期：2026-10-28。Windows 11 专业版 x64，系统版本 10.0.26300；Node.js 24.21.0、pnpm 10.34.9、Electron 45.0.0。

## 实现

- electron-builder 26.18.0（MIT）生成 NSIS EXE。当前用户安装、可选路径、中文/英文、快捷方式与卸载入口，不请求管理员提升。
- 冻结锁文件白名单部署生产依赖，原创 SVG 转多尺寸 ICO；窗口/Provider/SQLite worker 独立运行，不依赖源码目录。
- 捆绑校验过的 mpv `v0.41.0-dev-gad5877eda` 与 Vulkan Loader；安装版固定使用 resources/mpv，不从 PATH 回退。
- 构建前后审计敏感路径与越界依赖链接，附源码提交/dirty 状态、运行时版本与安装器 SHA-256。
- 未签名，不发布远端，不执行 mpv 注册脚本，不修改媒体关联或系统 PATH。卸载配置保留用户数据；测试只用合成临时配置。

## 已执行

- `pnpm package:win` 实际生成 EXE；electron-winstaller 生命周期脚本仍禁用，本目标不使用 Squirrel。
- `pnpm test:package:win`：独立运行目录通过沙箱、匿名后台、SQLite、无 mpv PATH 的真实 WASAPI、定位、单实例、退出清理和重启恢复。
- `pnpm test:installer:win`：实际安装到中文/空格路径后，同一套运行时检查通过；实际卸载后程序与卸载注册项清理通过。
- 首轮中文路径进程校验受 PowerShell 默认编码影响，现显式输出 UTF-8 并复验通过，没有放宽进程归属检查。
- `pnpm check`、`pnpm typecheck`、143 项单元测试及四个新脚本语法检查通过；`pnpm audit --prod` 未发现已知漏洞。实际运行目录审计 4792 个文件，安装前与安装后两种运行时测试均通过。

## 限制

未自动操作安装向导页面；未验证跨版本升级、其他 Windows/架构/高 DPI、签名/SmartScreen 信誉、真实账号与设备切换。测试使用静音 PCM WAV 与实际 WASAPI，不代表用户听音验收。项目整体许可、mpv 静态依赖的完整对应源码/许可组合仍需在公开分发前补齐，本次产物为本地验证包。
