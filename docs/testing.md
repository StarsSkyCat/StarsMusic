# 测试与验收

## 当前检查

```bash
pnpm check
pnpm typecheck
pnpm test
pnpm test:playback
pnpm test:desktop
pnpm test:e2e
```

check 检查脚本语法、仓库必需文件、JSON 配置、Markdown 内联相对链接、代码围栏及行尾格式。不校验链接锚点、引用式链接或 YAML 语法，不访问外部链接，不验证第三方接口、登录、音频或桌面兼容性。

typecheck 使用 tsc 与 vue-tsc 检查全部应用及测试源码。test 使用 Node 内置测试器，覆盖其他窗口/子帧/变更文档/额外参数被拒绝、开发地址限制和后台响应校验。

当前单元/边界测试（数量以执行输出为准）：原有 IPC、领域契约、会话守卫和播放快照，加上网易云数据投影/大整数/扫码与账号验证/旧账号与旧页面响应丢弃/取消与到期/媒体网关，酷狗具体 IPC、扫码与账号一致性、过期、SSA、旧响应丢弃、歌单视图隔离、大页/字符串字段容错、hash-only 取链、试听文件名匹配、流主机和试听边界，以及凭据 bundle 白名单、保险库保存/读取/删除/锁定/权限、两个平台导出与恢复。全部使用明确标识的合成响应，不调用真实登录。

test:playback 有 8 项实际 mpv 场景，在 Linux/Windows 使用 null 输出与合成 WAV，检查原有本地行为和经 loopback 网关的真实 HTTP 解码、试听长度限制、旧解析取消、本地切换与网关清理；其中包含合成酷狗资源与跨平台媒体主机隔离。这证明控制和解码链路，不等同于扬声器出声或发行包兼容性。

test:e2e 先构建，再启动实际 Electron，检查桥接/沙箱、弹窗与导航、960×640 布局以及本地选择/播放/暂停/定位。只替代原生选择器交互，使用实际 mpv 和默认系统音频输出，拒绝 null 输出；关闭应用后验证 mpv PID 已退出。需要 Linux 或 Windows、mpv、可用的图形和音频会话。Playwright 显式启用 chromiumSandbox；Linux 通过 /proc 检查 renderer 的 Seccomp 与 NoNewPrivs，Windows 检查 Electron sandboxed 指标。子进程检查从实际 Electron 主进程 PID 查询，Windows 使用 CIM。Linux D-Bus/MPRIS 和 Windows 系统用例在另一平台明确跳过。临时配置和合成文件会清理，截图留在 Git 忽略的 artifacts/；不需要下载 Playwright 浏览器。

桌面 E2E 也实际启动网易云与酷狗 utilityProcess，验证匿名 getState/本地退出及窄桥接，禁止自动生成真实二维码或授权账号；同时验证 preload 的 credentials 白名单、状态投影，以及 basic 密码库环境下本地加密保存仍可用。pnpm probe:netease、pnpm probe:kugou 是显式匿名联网探测，不在 CI 执行。真实听音与权限结果独立记录在 [网易云验证](validation/2026-10-26-netease.md) 与 [酷狗验证](validation/2026-10-26-kugou.md)；凭据结果见 [SQLite 保存验证](validation/2026-10-26-sqlite-credentials.md)。

CI 配置在 Linux/Windows 执行冻结安装、类型、合成契约和构建，Linux 另执行文档与 mpv null 集成测试；Windows mpv/E2E 目前在本机执行。CI 没有真实平台登录、图形、安装包或系统音频验收。新增 Windows job 尚未推送，远端结果需实际观察。

## 实现后的测试分层

| 范围 | 必须覆盖的行为 |
| --- | --- |
| Provider 契约 | 字段缺失、错误状态、分页、渠道区分、会话过期、权限限制 |
| 登录状态 | 扫码过期、取消、关闭窗口、断网重试、旧 Challenge 返回 |
| 队列与音频 | 连续切歌、重复曲目、随机历史、旧事件丢弃、进程退出与重启 |
| 缓存与存储 | 跨账号隔离、退出清理、事务、迁移、缺失或移动的本地文件 |
| 界面 E2E | 导航、搜索、队列控制、可见错误、键盘操作 |
| Linux 实机 | MPRIS、X11/Wayland、音频设备、托盘缺失、密钥服务缺失 |

纯逻辑和契约测试使用脱敏固定响应；真实账号验证只经用户授权的官方登录流程，在本机人工完成。CI 不注入平台 Cookie 或 Token。

## P0 接入验收

网易云、酷狗分别完成登录、账号读取、私人歌单读取、曲目解析和实际播放。重启恢复、退出清理、链接过期、权限拒绝分别记录。昵称和头像出现不作为接入完成依据。

酷狗网页登录与 App 扫码分渠道记录。无法播放时区分身份状态、Token 渠道、曲目权限和网络问题，不擅自判断为会员问题。

凭据保存需记录实际本地加密后端、数据库/密钥权限、真实账号保存/重启恢复、损坏/密钥丢失、清除和退出删除结果；无系统密钥服务不能阻断当前 SQLite 记住登录。

使用 [验证模板](templates/p0-validation.md) 记录每次实验。结果状态只能是未执行、通过、失败、受限；“受限”要写明实际可用能力和影响。

## Linux 发行验证

首批覆盖 Ubuntu/Debian、Fedora、Arch 的代表环境。记录精确版本、架构、桌面、显示协议、音频服务、Electron 与 mpv 版本。具体目标见 [设计方案](design-and-architecture.md)。

每个发布渠道检查安装、启动、声音、切歌、媒体控制、退出、重启与卸载。AppImage 检查 FUSE 和解包路径；原生包验证 mpv 及系统库依赖。构建成功或无界面容器通过不代替实机验收。

歌词/封面回归使用明确标识的合成 LRC、图片头与后台响应，覆盖时间标签/偏移、定位高亮、图片域名/类型限制、快速切歌旧结果、未登记 ID 和会话退出。桌面 E2E 额外注入标明合成的 presentation 快照来验证图片解码、歌词渲染及最小窗口布局；实际音频仍由 mpv/PipeWire 播放。匿名平台探测与真实账号验收另记，不以合成快照宣称平台可用，见 [记录](validation/2026-10-26-presentation.md)。

登录保存现已改为本地随机密钥 + SQLite；当前共 71 项单元回归，包含 SQLite 事务失败回滚检查，数量以执行结果为准。凭据测试使用真实 SQLite 与 AES-GCM 验证双平台跨实例恢复、密钥丢失/替换、数据篡改与旧加密 JSON 转换，不依赖系统密钥库。桌面 E2E 显式指定 basic 密码库，验证记住开关可用和实际 Electron 重启后设置保留；不自动向平台提交真实或合成账号。参见 [SQLite 记录](validation/2026-10-26-sqlite-credentials.md)。

2026-10-27 页面回归扩展为 3 项桌面测试：独立播放页无 dialog、空队列入口、暂停定位与再次进入当前歌词行、Esc 先关闭队列再返回列表、音频 generation 不变、筛选保留、歌单详情隐藏卡片网格、旧曲目不显示到新歌单及 960×640 无横向滚动。歌单/二维码渲染测试明确使用合成只读 UI 投影，不把它当作平台请求成功。见 [页面记录](validation/2026-10-27-listening-pages.md)。

2026-10-27 Linux 桌面集成：`test:desktop` 在隔离 session bus 中验证真实 MPRIS/mpv，以及明确标识的合成通知/portal/宿主协议。桌面 E2E 新建独立 dbus-daemon，验证实际 Electron StatusNotifier 注册与 D-BusMenu 操作、窗口内键、合成 portal 授权、关闭到托盘/恢复、通知点击、宿主丢失和重启设置。合成服务不会注册到用户真实总线。相关单元检查覆盖具体 system IPC、设置保存/损坏和 X11 逐项注册失败；X11 注册使用合成 runtime，不替代实机键盘验证。定位测试等待实际 mpv seek/playback-restart，检查实际位置；暂停音频缓冲可能使位置与目标相差少量时间，歌词用行中位置而非时间标签边界验收。完整范围见 [Linux 验证](validation/2026-10-27-linux-desktop.md)。
