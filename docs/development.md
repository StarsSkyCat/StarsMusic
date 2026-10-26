# 开发指南

## 当前能运行什么

目前提供文档、工作区配置、模块目录和基础检查脚本，尚无可启动的 Electron 应用。没有 pnpm dev、pnpm build、登录接口或播放器实现。

架构背景见 [设计方案](design-and-architecture.md)，任务顺序见 [路线图](roadmap.md)。

## 环境

- Linux x86_64 / glibc 为首要开发目标，其他平台后续验证。
- Node.js 24.x；.node-version 记录初始化时实际使用的 24.22.1。
- pnpm 10.34.9，以根 package.json 的 packageManager 为准。
- Git。mpv 留待音频 P0 使用，当前文档检查不依赖它。

已安装 pnpm 时，在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm check
```

环境已提供 Corepack、但没有 pnpm 命令时，可直接执行以下命令，无需全局安装：

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm check
```

Corepack 不随所有 Node 分发提供；缺失时按 pnpm 官方安装说明安装 packageManager 指定版本。只有 Node 时仍可执行当前检查：

```bash
node --check scripts/check.mjs
node scripts/check.mjs
```

包管理器首次运行可能需要联网下载。当前无业务依赖；后续引入 Electron、SQLite 等依赖时，评估安装脚本并明确允许构建的依赖，不全局放开依赖脚本。

受限环境若用户缓存目录只读，可将缓存定向到临时目录；例如当前检查可直接用 Node，不需要修改全局配置或提高权限。

## 目录边界

| 目录 | 责任 |
| --- | --- |
| src/main | Electron 主进程入口、窗口、IPC 校验和生命周期 |
| src/preload | contextBridge API 白名单 |
| src/renderer | Vue 界面及状态投影 |
| packages/contracts | 领域模型、平台 ID、IPC 契约、归一化错误 |
| packages/providers | 网易云、酷狗和本地音乐的适配边界 |
| packages/playback | mpv 控制、队列、播放状态与歌词时间轴 |
| packages/storage | SQLite、迁移、缓存和标签索引 |
| packages/desktop | Linux MPRIS、通知、托盘与其他平台接口 |
| packaging | 各渠道打包配置和依赖记录 |
| scripts | 可直接执行的仓库工具 |
| docs | 设计、开发、决策及验证记录 |

上述模块当前只有责任说明，不是已完成的工作区包。首次实现时再增加实际 package.json、TypeScript 配置、导出与依赖；不创建空包冒充功能。

公共 contracts 不导入 Electron/Vue/Provider SDK；renderer 只能使用 preload API。平台请求在 Provider 后台处理。重型扫描和数据库工作与窗口主进程分离。

## 日常开发

1. 阅读 AGENTS.md，检查 git status 和当前任务状态。
2. 对照 P0 验收目标完成最小闭环；有新发现就更新路线图和 ADR。
3. TypeScript 使用严格模式，代码命名英文；文档与用户提示默认中文。
4. 外部数据需运行时校验，ID 用 string，错误归一化，异步操作支持取消和过期事件丢弃。
5. 运行 pnpm check 与实际变更相关的验证，报告输出和环境。

新增依赖采用 pnpm，不并存 npm/yarn 锁文件。Node 运行时、依赖版本或入口命令变更时，同步更新文档、锁文件和 CI。

## Git 初始化与提交

仓库应使用 main 作为初始分支。Git 元数据受限时，通过环境提供的权限流程执行初始化，不把 .git 移到其他位置绕过限制。

默认不自动配置远程地址、推送、修改全局 Git 身份或创建发布标签。初始化与文件变更状态应分别记录；没有提交时明确说明尚无初始提交。

开发检查不要求联网、真实平台账号或读取用户主目录的凭据文件。
