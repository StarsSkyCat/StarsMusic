# 开发指南

## 环境与启动

- Node.js 24.x，以 .node-version 为开发版本基线；pnpm 10.34.9，以 package.json 的 packageManager 为准。
- Linux x86_64 / glibc 为首要目标，Windows x64 已适配开发启动；macOS 尚未验证。
- 播放需要 Linux 系统 mpv 或 Windows PATH 中的 mpv.exe；文档、类型检查、单元测试和构建不依赖 mpv。平台准备见 [平台说明](platforms.md)。

```bash
pnpm install --frozen-lockfile
pnpm setup:electron
pnpm dev
```

依赖安装禁止自动执行生命周期脚本。setup:electron 显式下载固定版本 Electron 并校验包内校验值，不需要放开所有依赖脚本。首次安装需要网络；环境提供 Corepack 时可用 `corepack pnpm` 替代 pnpm，Corepack 并非所有 Node 分发都自带。

开发服务器仅绑定 127.0.0.1:5173，端口冲突直接失败。窗口关闭或终端 Ctrl+C 退出；关闭到托盘启用时使用托盘或设置页的退出入口。

设置页仅提供外观与桌面偏好；桌面能力明细、重新检测和通知测试不在设置中展示。网易云与酷狗的登录、账号信息、会员同步与退出位于各自页面开头，连接入口定位到该区域。记住登录仍在扫码时按平台选择，退出账号自动清除对应保存项，不再提供单独的清除入口。

## 常用命令

| 命令 | 作用 / 要求 |
| --- | --- |
| pnpm check / pnpm check:docs | 离线仓库与文档检查 |
| pnpm typecheck | 主进程、preload、Vue 和测试的严格类型检查 |
| pnpm test | 合成数据单元测试，不登录、不访问平台 |
| pnpm build | 编译应用到 out/，不执行类型检查、不生成安装包 |
| pnpm start | 启动已有构建，需要先 build 和 setup:electron |
| pnpm test:playback | 真实 mpv + 合成 WAV + null 输出，Linux / Windows |
| pnpm test:desktop | Linux 隔离 D-Bus 与 mpv，需要 dbus-run-session |
| pnpm test:e2e | 先构建，再运行实际 Electron / mpv，需要图形和音频会话 |
| pnpm package:arch / pnpm test:package | Arch 原生包构建 / 独立运行检查 |
| pnpm package:win / pnpm test:package:win | Windows EXE 构建 / 独立运行检查 |
| pnpm test:installer:win | 实际临时安装 / 运行 / 卸载；拒绝覆盖既有安装 |

验证范围与判断方法见 [测试说明](testing.md)。打包工具、固定 mpv 输入和输出路径见 [打包说明](../packaging/README.md)。

只有 Node.js 时也可执行：

```bash
node --check scripts/check.mjs
node scripts/check.mjs
```

## 匿名联网探测

`pnpm probe:netease`、`pnpm probe:kugou` 检查匿名扫码端点，不输出二维码、key 或原始响应；`pnpm probe:netease-discovery`、`pnpm probe:kugou-discovery` 检查公开发现、搜索和资源元数据。这些命令显式联网，不在 CI 执行，不代表真实账号登录或播放验收。

## 开发流程

1. 阅读 [AGENTS.md](../AGENTS.md)，检查 Git 状态，保留已有修改。
2. 完成一个明确的小改动，行为变化同步更新对应主题文档。
3. 运行 pnpm check 以及相关类型、单元或集成测试；记录实际环境和未执行项。
4. 验证通过后提交该步骤，再开始下一步；不自动推送。

包管理器统一 pnpm，依赖只在实际使用时引入并固定版本，同步锁文件和 [依赖清单](dependencies.md)。不新增 npm / Yarn 锁文件，不提交 node_modules/、out/、release/、artifacts/ 或真实账号数据。

模块职责见 [架构说明](architecture.md)，数据和 IPC 约束见 [安全说明](security.md)。packages/ 当前由根包统一编译与测试，尚未作为独立 npm 包发布；不要为目录占位增加空包配置。
