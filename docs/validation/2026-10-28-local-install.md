# 界面重设计后的本地安装更新

日期：2026-10-28。环境：本机 Arch Linux x86_64、niri / Wayland，XWayland 可用。更新已安装的 StarsMusic，不代表其他发行版或其他机器已验证。

- 源码提交：`4f2184f5bc18609c82d627fc6af5847a49b39296`，构建时工作区干净；包版本 `0.0.0.r63.g4f2184f5-1`，Electron 45.0.0。
- 使用 `pnpm package:arch` 完成类型检查、构建、生产依赖部署和 makepkg。包内审计 5045 个运行时文件；归档位于忽略的 `release/starsmusic-0.0.0.r63.g4f2184f5-1-x86_64.pkg.tar.zst`，SHA-256：`683a8a7164fb98779f28df2628b0d5c5bea86fd29cb35c02212a5b1bdec16e83`。`sha256sum -c` 通过。
- 升级前对独立包运行 `pnpm test:package`：Wayland、X11、实际 PipeWire 输出、MPRIS Pause/Play、沙箱、匿名双平台后台、单实例和退出均通过。X11 在当前 niri/XWayland 下不接受原生最大化/最小化请求；Wayland 的窗口状态操作通过。托盘能力报告 `unknown`。
- 通过系统 Polkit 授权执行 `pacman -U`，从已安装的 `0.0.0.r60.gb0e9f3c1-1` 升级到 `0.0.0.r63.g4f2184f5-1`。pacman 完成包变更、图标缓存和桌面入口缓存钩子。
- 升级后 `pacman -Qk starsmusic` 报告 5615 个文件、0 个缺失；`/opt/starsmusic/BUILD-METADATA.json` 指向上述提交且 `localChanges=false`。宿主核对 `/opt/starsmusic/chrome-sandbox` 为 root:root / 4755，`/usr/bin/starsmusic` 为 root:root / 755。
- 从实际安装路径 `pnpm test:package /opt/starsmusic/starsmusic` 再次验证 Wayland/X11、实际 PipeWire、MPRIS Pause/Play、匿名后台、单实例和退出，结果同升级前。使用临时用户目录及合成静音 WAV，未读取或修改真实账号与播放队列；截图仅保存在 Git 忽略的 artifacts/。

本次不验证真实账号权限矩阵、人工听感、其他 Linux 桌面环境或发行格式。GUI 界面改动的源码级检查见[全界面重设计验证](2026-10-28-interface-redesign.md)。
