# P0 凭据持久化验证

> 历史验证记录：登录保存随后按用户要求改为本地随机密钥 + SQLite；当前行为与结果见 [SQLite 记录](2026-10-26-sqlite-credentials.md)。

## 基本信息

- 日期、执行者：2026-10-26，开发代理自动检查。
- 目标能力：系统密钥服务、临时会话模式、重启恢复、锁定、退出清理与旧请求取消。
- 结果：**受限**。保险库、平台导出/恢复、临时会话回退和自动化验证通过；本机没有安全系统密钥后端，真实加密持久化与跨重启恢复未执行。
- 对应提交或工作区状态：酷狗 hash-only 修复 `32f96e4` 之后的凭据持久化工作区；提交前验证。
- 环境：Linux x86_64、Wayland、Node 24.22.1、Electron 45.0.0、mpv 0.41.0。
- 系统密钥后端：`safeStorage.getSelectedStorageBackend()` 返回 `basic_text`；`safeStorage.isEncryptionAvailable()` 为 false，不能作为安全持久化证据。

## 实现与操作

1. 增加 `CredentialVault`：使用注入的加密接口，把网易云/酷狗凭据 bundle 加密为密文文件；文件外层只保留版本、记住开关、平台键、密文和更新时间。
2. 写入使用 `userData/credentials.json`、目录 0700、同目录临时文件加 `rename`，文件权限 0600；不含明文 Cookie/Token/账号昵称。
3. 主进程使用 Electron `safeStorage` 异步接口。Linux 只接受 libsecret/KWallet 后端；`basic_text` 明确视为不可用，不降级为明文或弱编码保存。
4. preload 只暴露 `getStatus`、`setRemember`、`clear`、`onChanged`；主进程校验来源和参数，状态不含账号 ID、昵称或凭据。
5. 两个 Provider 在账号验证成功后导出白名单凭据；主进程只在“记住登录”开启且后端可用时保存。启动时解密并向后台发送恢复请求，后台重新请求账号接口验证，不把“可解密”当作已连接。
6. 退出平台删除对应保存项；关闭记住或清除保存删除全部。密钥不可用/锁定/保存失败显示固定错误，不影响当前内存会话。

## 自动化结果

- `pnpm test` 的等价命令：**43 项通过**。
  - 新增凭据 bundle 白名单与格式校验。
  - 新增 `CredentialVault` 保存/读取/删除/关闭记住、不可用时不写文件、密文损坏锁定、清除后恢复、文件 0600 权限。
  - 新增网易云与酷狗登录后导出凭据、从凭据恢复并通过账号接口重新验证。
- `pnpm test:e2e`：**1 项通过**。实际启动 Electron，确认 preload 新增 credentials 白名单方法、状态投影，以及本机 `basic_text` 下 `setRemember(true)` 返回 `credential-unavailable` 且 `remembered` 不会变成 true。
- `pnpm typecheck`、`pnpm build`、`pnpm test:playback`、文档检查和 `git diff --check` 通过。
- 本机 pnpm 入口受只读 HOME 限制，实际使用 `node_modules/.bin` 与 `node --test` 执行等价命令；这是代理环境限制，不改变仓库标准命令。

## 未执行

- 真实 GNOME Keyring 或 KWallet 后端的加密保存、应用重启自动恢复、密钥锁定/解锁。
- 真实账号凭据跨重启后的网易云/酷狗请求闭环；扫码仍由用户完成。
- 密钥轮换 `shouldReEncrypt` 的自动重新加密。
- 磁盘满、文件损坏、权限被拒绝和用户目录只读的人工矩阵。
- Windows/macOS safeStorage 后端验证。

## 安全与隐私

自动化全部使用合成 Cookie/Token/设备标识；仓库、日志、截图和测试快照不含真实凭据或账号标识。`basic_text` 环境没有生成凭据文件；文件写入测试在临时目录完成。主进程、后台进程和 renderer 的边界保持：renderer 只收到状态投影，不接触密文或明文凭据。

## 结论与后续

代码已具备安全密钥后端下的持久化路径和临时会话回退，但本机只能验证回退与逻辑，不能宣称真实系统密钥持久化、重启恢复或锁定已经通过。路线图第 6 项标记为“受限通过”；需要在具备 GNOME Keyring/KWallet 的实际 Linux 桌面补测后再改为通过。
