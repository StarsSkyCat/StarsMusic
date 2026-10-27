# 安装包与分发

当前提供 Arch Linux x86_64 本地原生验证包，使用固定 Electron 45 运行时与 pnpm 生产依赖，依赖系统 mpv。AppImage、DEB、RPM、Flatpak 和 ARM64 仍待实现与验证。

原生包需声明并验证 mpv 依赖；便携包需记录 mpv/FFmpeg 构建、运行库与许可。安装后必须验证音频、MPRIS 和退出清理，不能仅凭构建通过宣称兼容。

实施顺序见 [开发路线图](../docs/roadmap.md)。

## Arch Linux 本地包

需要已安装的 Node.js / pnpm / Electron 运行时、makepkg / fakeroot / tar / zstd、librsvg 的 rsvg-convert 和 desktop-file-utils。执行：

```bash
pnpm package:arch
pnpm test:package
```

生成的 `.pkg.tar.zst`、SHA-256 和独立运行目录保存在忽略的 release/，latest-arch.json 标记本次产物。版本包含源码提交计数与短 hash，未提交构建另标 local。打包脚本使用 package.json 的 files 白名单，仅纳入 out、必要声明和生产依赖；pnpm 禁用安装脚本并按锁文件部署，缓存定向到 release/，不读取用户登录库。构建时可从 npm 下载锁定依赖，不请求平台账号。

包内额外检查禁止的账号/数据库/导出/测试产物路径，以及依赖链接是否全部指向包内；移除 pnpm 的机器路径元数据。保留 Electron 的 LICENSE / LICENSES.chromium.html、应用第三方声明和各生产依赖自带许可。mpv/FFmpeg 不捆绑，pacman 声明系统 mpv 等运行依赖。本包仅供本机验证，项目整体许可与公开发行审计仍未完成。

系统安装采用 `sudo pacman -U` 或标准 Polkit 授权后的 `pacman -U`，由 pacman 管理 /opt/starsmusic、/usr/bin/starsmusic、桌面入口与图标；卸载使用 `sudo pacman -R starsmusic`。安装/卸载不复制或删除用户的 StarsMusic userData，登录和播放记录继续由应用管理。程序启用 Electron 沙箱，系统包中的 chrome-sandbox 使用 root 所有者及 4755 权限；不添加 --no-sandbox。安装版采用单实例锁，重复打开显示现有窗口。

Linux 桌面入口和原创 SVG/PNG 图标与 DesktopEntry / portal 身份一致。桌面入口不表示全局快捷键已获授权；`test:package` 以临时配置实际启动包，分别验证可用的 Wayland/X11、匿名后台、系统音频输出、MPRIS 与单实例，不自动扫码。可以传入已安装可执行文件再验证：

```bash
pnpm test:package /opt/starsmusic/starsmusic
```

遵循 [Electron 手动分发](https://www.electronjs.org/docs/latest/tutorial/application-distribution)、[pnpm 10 deploy](https://pnpm.io/10.x/cli/deploy) 与 [Arch PKGBUILD](https://man.archlinux.org/man/PKGBUILD.5.en)；没有新增 npm 打包器依赖。本机证据见 [Arch 验证记录](../docs/validation/2026-10-27-arch-package.md)。
