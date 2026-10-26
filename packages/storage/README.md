# 本地存储

后续实现 SQLite、迁移、缓存和本地文件索引，在独立后台执行。私密凭据由 CredentialVault 管理，不以明文写入数据库或日志。

当前尚未安装 SQLite 绑定，也未创建数据库。增加绑定时验证 Electron ABI、目标架构和安装脚本。
