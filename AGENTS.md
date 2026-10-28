# StarsMusic 开发规则

## 项目与当前阶段

- Linux 优先的跨平台音乐播放器，网易云、酷狗分别接入；Windows 已启动开发适配，macOS 后续实现。Windows 范围见 docs/platforms.md 与 docs/testing.md。
- 技术方向：Electron、Vue 3、TypeScript、mpv、SQLite。已有桌面基础、本地播放、网易云临时扫码/歌单/播放闭环、酷狗 App 扫码/歌单/曲目/部分播放（受限；已改为 hash-only 取链修复错配），以及可选 SQLite 加密记住登录（用户选择本地随机密钥，无需系统密钥服务）；酷狗完整权限矩阵、真实账号跨重启验收和发行验证尚未完成，范围以 docs/testing.md 的验证摘要为准。
- 先读 README.md、docs/development.md 和 docs/roadmap.md；架构背景见 docs/architecture.md；文档维护约定见 docs/README.md。
- 使用标准文件名 AGENTS.md。不要创建 AGENDS.md 等重复规则文件。子目录规则只补充所在范围，避免复制根规则。

## 工作方式

- 用户已授权的常规实现、文档修改和验证直接推进；明确区分已实现、已测试和规划能力。
- 每完成一个开发步骤，验证通过后先提交该步骤，再开始下一步；不自动推送。
- 先检查当前文件和 Git 状态，保留用户已有修改；不擅自 reset、清理工作区或覆盖历史。
- 开发说明默认中文，代码标识符用英文。以小而完整的改动推进，行为变化同步更新文档。
- 不使用占位成功响应冒充平台接入；Mock、假数据和开发开关必须明确标识。
- 新依赖只在实际使用时引入，记录用途、版本和许可；包管理器统一 pnpm，不提交其他锁文件。
- 不因为文件中存在某个库的名字就提前安装全部运行时依赖。

## 模块边界

- src/main：窗口、生命周期、IPC 校验与服务协调，不执行重型扫描或同步数据库工作。
- src/preload：只通过 contextBridge 暴露具体白名单方法，不暴露 ipcRenderer、Node、任意路径读写或任意请求接口。
- src/renderer：Vue 界面、UI 状态和播放状态投影；不得直接读取凭据、调用平台私有接口或启动进程。
- packages/contracts：公共领域模型与 IPC 契约，不依赖 Electron、Vue 和具体平台 SDK。
- packages/providers：各平台接口和响应归一化，不导入 renderer。
- packages/playback：队列及唯一播放状态源；UI、歌词、MPRIS 订阅同一状态。
- packages/storage：SQLite、迁移、缓存和本地文件索引；密钥材料交由凭据服务管理。
- packages/desktop：系统能力适配。Linux 专属逻辑不得散落在 UI 组件中。
- TypeScript 使用严格模式；输入在运行时校验，外部响应先视为 unknown。平台 ID 用 string。

## 会话与播放约束

- 网易云与酷狗会话独立。缓存按平台、账号、客户端渠道分区，酷狗网页和 App Token 不混用。
- Cookie、Token、手机号、带签名的播放地址不进入仓库、日志、截图、测试快照或页面持久存储。
- 官方授权窗口隔离 session，关闭 Node 集成，不加载业务 preload；跳转与凭据读取限制在验证过的官方授权链内。
- 凭据仅在可信后台处理；按用户选择，以本地随机密钥加密后写入 SQLite，不依赖系统密钥服务，不静默明文持久化。密钥与数据库分文件保存，并明确同获两者即可解密的边界；存储或密钥不可用时使用临时会话。
- 登录、退出、切账号、快速切歌使用 generation 或等效机制，丢弃旧请求与旧事件。
- 平台限制以实际响应为准；账号已登录不代表所有歌曲和音质可播放。
- mpv 用参数数组启动，不拼 shell 命令；IPC 私有，切歌清理旧请求头，应用退出清理子进程。

## 验证与交付

- 当前可用命令：pnpm check、typecheck、test、test:playback、test:desktop、build、dev、start、test:e2e；桌面启动前运行 pnpm setup:electron，音频测试需 Linux 系统 mpv 或 Windows PATH 中的 mpv.exe；test:desktop 仅 Linux。无 pnpm 时仍可运行 node scripts/check.mjs 检查文档。
- 新增脚本或命令时先使其可运行，再写入文档；不创建输出“成功”但不做验证的 test/build 脚本。
- 文档修改运行文档检查；逻辑变更增加或运行能验证行为的检查，避免只重复实现的测试。
- 登录真实测试由用户在官方授权流程中完成；不要求在聊天或配置文件中粘贴真实凭据。
- pnpm probe:netease、pnpm probe:kugou 是显式匿名联网探测，不能替代真实账号验证；CI 不执行真实登录，不保存真实二维码或私人歌单截图。
- Linux 交付验证实际安装包、X11/Wayland、音频输出与 MPRIS；构建成功不等于发行版兼容。
- 最终说明具体修改、实际执行的检查及未完成项；不把开发机结果描述成跨平台验证。

- Windows 安装包命令：pnpm package:win、test:package:win、test:installer:win。后者会实际临时安装/卸载，必须拒绝覆盖既有安装；安装版使用固定校验的内置 mpv，不从 PATH 回退。完整发行许可、签名及升级验证仍待完成。

## Code Review Rules

- 优先检查凭据泄漏、过宽 IPC、旧响应覆盖新状态、跨账号缓存污染和重复音频进程。
- 指出破坏 Linux 桌面集成、依赖不兼容或数据库迁移丢数据的具体路径与影响。
- 审查依赖与复制代码的实际来源；不将参考项目的代码或视觉资产默认为可自由复用。
