# 本地存储

已实现 `src/credential-store.ts`：版本 1 SQLite 凭据库、平台密文行与记住开关、原子事务写入、版本/损坏拒绝和显式清除重建。所有同步 SQLite 只在专用 Node worker 中执行；使用 Node/Electron 自带 node:sqlite，无额外 npm 绑定或数据库服务。

密钥由主进程 LocalKeyCipher 管理，SQLite 从不接收明文平台凭据或密钥。目录/文件权限限制、认证加密与保护边界见 [凭据说明](../../docs/credentials.md)。node:sqlite 随运行时分发，尚未完成 Linux 安装包或 Windows/macOS 验证。

音乐库、缓存、本地文件索引、通用数据库迁移和队列恢复仍待实现；当前凭据库不代表这些功能完成。
