# Windows 开发适配

Windows x64 开发适配已启动。播放引擎已接入 Windows mpv 命名管道；安装包、签名、系统媒体面板与发行兼容性仍待实现或验证。结果见 [验证记录](validation/2026-10-28-windows.md)。

## 环境与启动

需要 Node.js 24.x、pnpm 10.34.9，以及可运行的 mpv.exe（本轮验证 0.41 开发构建）。从 [mpv 官方安装页](https://mpv.io/installation/) 选择 Windows 构建，自行核对来源与校验值；应用不自动下载、安装播放器或修改系统 PATH。官方 CI 构建用于开发验证，不作为发行包依赖承诺。

在 PowerShell 中将已解压的 mpv 目录加入当前终端的 PATH，再运行项目：

```powershell
$env:PATH = 'C:\Tools\mpv;' + $env:PATH
mpv.exe --version
pnpm install --frozen-lockfile
pnpm setup:electron
pnpm dev
```

上述路径替换为本机实际目录。开发构建与单元测试不需要 mpv；播放集成测试缺少 mpv 时会失败。

```powershell
pnpm check
pnpm typecheck
pnpm test
pnpm test:playback
pnpm build
```

`pnpm test:desktop` 仍为 Linux D-Bus 集成测试，需要在 Linux 环境执行。

## 播放与保护边界

- 使用参数数组、shell=false 和 windowsHide，不弹出 mpv 控制台。
- 每个实例生成随机 `\\.\pipe\starsmusic-UUID`，三秒内连接并完成 JSON IPC 请求，不暴露到网络；失败清理子进程。
- 管道访问限制由 [mpv Windows IPC 实现](https://github.com/mpv-player/mpv/blob/master/input/ipc-win.c) 提供：仅当前用户且相同或更高完整性级别可读写，并拒绝远程客户端。随机名称不能代替访问控制，也不能隔离同用户同级进程。
- Linux 继续使用继承 FD；Windows 退出先发送 quit，再按超时终止，并等待旧进程完全关闭才切歌。
- 沿用本机媒体网关，签名源地址与凭据不进入 mpv 命令行或 renderer。
- 登录密钥和 SQLite 仍分文件保存。Windows 权限由用户目录的 NTFS ACL 决定，POSIX 0700/0600 不代表 Windows ACL 隔离；同获密钥与数据库即可解密。

## 待完成验收

真实账号扫码与跨重启恢复、不同音频格式与输出设备、Windows 版本/缩放矩阵、系统媒体控制、安装包和签名需要独立验证。Linux 的历史实测结果不计入 Windows 验收。
