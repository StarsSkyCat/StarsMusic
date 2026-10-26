# 凭据持久化

按用户选择，当前“记住登录”使用 **SQLite + 本地随机密钥 + AES-256-GCM**，新保存不依赖 GNOME Keyring/KWallet，不需要安装系统 SQLite 服务。默认关闭，关闭时登录只保留在内存；不会保存密码或二维码。

## 存储与保护边界

- 数据库为 Electron `userData/credentials.sqlite`，密钥单独位于 `userData/keys/login.key`；随机密钥 32 字节，文件不包含账号信息。Linux 目录 0700、文件 0600；Windows/macOS 权限与发行物未验证。
- 每次加密使用新的随机 12 字节 nonce、AES-256-GCM 认证标签及固定格式标识，密文携带版本。账号 ID、昵称、Cookie、Token 与设备标识均在密文内；数据库外层只含平台键、更新时间、记住开关和版本。
- 本地密钥文件可被同用户程序读取。**同时取得数据库与密钥文件即可解密**，这一方案没有系统密钥库的隔离能力；UI 明确提示，不能将其描述成防止同用户恶意程序或整个应用数据目录泄漏。数据库自身没有启用整库加密，凭据字段在写入前单独加密。
- 不使用应用内置固定密码、机器码或 Base64 冒充密钥保护。凭据、密钥、数据库内容不进入日志、renderer、截图或页面存储。
- 使用 Node/Electron 内置 `node:sqlite`，无需新增 SQLite npm 绑定。同步数据库工作仅在专用 Node worker 中执行；主进程只使用具体的异步读/写/清除消息，renderer 没有 SQL 或文件接口。

## 用户流程

1. 在网易云或酷狗的二维码区域勾选“记住登录”，两个平台分别选择，默认不勾选。本地目录、数据库或密钥不可用时明确报告，不伪装启用成功。
2. 正常通过官方 App 扫码；账号验证后，后台把白名单凭据交给主进程。本次扫码未勾选时不保存，下次登录重新选择；只有实际需要保存时生成随机密钥。
3. 关闭应用保留密文和本地密钥，下次启动解密后由对应 Provider **重新请求账号接口**。不能仅凭数据库中有记录就进入 connected。
4. 退出单个平台删除该平台记录并撤销该平台选择；取消扫码/重新获取二维码也重置本次选择。取消勾选只删除对应平台保存，另一个平台不受影响；“清除已保存登录”重建空凭据库并删除本地密钥。删除不撤销平台侧会话，也不保证清除系统备份或外部副本。

## 模型、事务与竞态

- 数据库版本为 1，设置与凭据分别建表；平台只接受 netease/kugou，SQL 使用绑定参数。单次保存/删除在事务中完成，失败回滚，未知版本与损坏数据库拒绝打开，不自动覆盖。
- 凭据仍严格绑定平台、账号和客户端渠道：网易云为 netease-app 的白名单 Cookie/设备数据；酷狗为 kugou-app 的 Token/设备数据，不与网页 Cookie 混用。
- 退出、关闭记住、清除和关闭应用推进撤销代次；较晚完成的加密不能重新写回。异步导出后再次检查平台 generation 与账号。
- 主进程内 CredentialVault 管理序列与加密，CredentialStoreClient 通过 Node worker 调用 packages/storage 的 SQLite 实现；应用退出等待队列和存储线程清理。
- preload 仍只暴露 credentials.getStatus/setRemember(provider, boolean)/clear/onChanged，状态有递增 revision、各平台 rememberedProviders 和 savedProviders，不含账号 ID、昵称、密文、密钥或文件路径。未完成登录的勾选只属于当前应用会话，重启不会沿用；已有密文记录按对应平台恢复。

## 失效、损坏与旧版迁移

- 平台 Token 过期、账号不匹配等验证失败仍要求重新扫码；网络/超时不自动删除有效密文，不无限重试。记住登录不能保证永久有效。
- 已有密文但本地密钥丢失时，不生成新密钥替换；错误密钥、认证失败、损坏密文进入不可用/锁定状态。用户明确清除后才能重建并重新扫码。
- 旧 `credentials.json` 仅在新库从未初始化且原系统密钥可正常解密时自动转为新密文，SQLite 事务提交后才删除旧文件。失败或旧系统密钥不可用时保留旧文件；可以重新扫码保存到新库，新库一旦初始化就不会再导入旧登录覆盖新选择。旧文件无法解密时的遗留副本需用户另行清理。
- `SafeStorageCipher` 仅保留用于旧格式迁移；新登录保存不检查或依赖系统密码库。不会将旧 basic_text 当作受保护的迁移来源。

## 验证

- `pnpm test` 使用真实 SQLite、真实本地随机密钥和 AES-GCM 验证双平台写入/跨实例恢复、数据库中无明文合成凭据、权限、随机 nonce、密钥丢失/替换、密文篡改、损坏/未知版本、事务回滚和旧文件转换；其他撤销回归继续使用明确标识的 FakeCipher。
- `pnpm test:e2e` 构建并启动实际 Electron，显式指定 basic 密码库，验证记住开关仍可用、设置在实际应用重启后保留、清除与存储线程退出；实际音频仍使用 mpv/PipeWire。不自动扫码，不向平台提交合成账号。
- 用户真实账号的跨重启恢复、平台会话有效期、安装包、Windows/macOS 尚待验收。详见 [SQLite 验证记录](validation/2026-10-26-sqlite-credentials.md)；原系统密钥方案的历史结果见 [旧记录](validation/2026-10-26-credentials.md)。

SQLite 的普通存储与加密扩展区别见 [SQLite 官方说明](https://sqlite.org/see/doc/trunk/www/readme.wiki)，本项目采用写入前的字段加密；算法接口见 [Node crypto 文档](https://nodejs.org/docs/latest-v24.x/api/crypto.html)。

2026-10-27 登录交互调整及验证见 [扫码保存记录](validation/2026-10-27-login-flow.md)。
