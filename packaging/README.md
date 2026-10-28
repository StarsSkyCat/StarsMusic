# 安装包与分发

当前提供 Arch Linux x86_64 原生验证包和 Windows x64 NSIS EXE 本地验证安装包。均使用固定 Electron 45 与 pnpm 生产依赖；Arch 依赖系统 mpv，Windows 内置 mpv。其他发行格式与架构仍待实现或验证。

原生包需声明并验证 mpv 依赖；便携包需记录 mpv/FFmpeg 构建、运行库与许可。安装后必须验证音频、MPRIS 和退出清理，不能仅凭构建通过宣称兼容。

实施顺序见 [开发路线图](../docs/roadmap.md)。

## Windows x64 EXE

在 Windows x64 准备 Node.js 24、pnpm 10.34.9、固定 Electron 运行时，以及 `windows/mpv-runtime.json` 指定的 mpv.exe 与 vulkan-1.dll。默认从忽略的 `.local/mpv` 读取，也可用 `STARSMUSIC_MPV_DIR` 指定目录；逐文件 SHA-256 不匹配时拒绝构建。官方 CI 归档可能过期，升级需重新核验清单。

```powershell
pnpm package:win
pnpm test:package:win
pnpm test:installer:win
```

- 构建执行类型检查、生产部署、原创 SVG 转 ICO 和 NSIS 打包；产物位于 `release/windows-版本/`，`release/latest-windows.json` 指向本次 EXE、独立运行目录和 SHA-256。版本含源码提交，未提交构建带 `.local`。
- 当前用户安装，无管理员提升，可选择路径，支持中文/英文，创建桌面/开始菜单快捷方式和卸载入口；安装后不自动运行，卸载不主动删除用户数据，不注册媒体关联或修改系统 PATH。
- 安装版固定使用自身 `resources/mpv/mpv.exe`，不从 PATH 回退。SQLite/Provider worker 保持独立文件，未启用 ASAR；白名单与路径审计排除登录数据、数据库、私钥、日志和测试截图。
- `test:package:win` 移除 mpv PATH，以独立临时配置检查真实包的沙箱、后台、SQLite、WASAPI、进程归属/退出、单实例和重启暂停恢复；可附已安装 StarsMusic.exe 路径。
- `test:installer:win` 会实际静默安装到项目临时中文/空格路径，测试安装版后卸载并核对注册项；发现既有 StarsMusic 安装会拒绝替换，不读取真实账号或 userData。

此包未签名，仅用于本地开发验证。第三方声明与现有许可文本随包保留；项目整体许可、静态音频库完整对应源码/许可组合与公开分发审计仍待完成，见 [运行时说明](windows/THIRD_PARTY.md) 和 [EXE 验证](../docs/validation/2026-10-28-windows-installer.md)。

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

遵循 [Electron 手动分发](https://www.electronjs.org/docs/latest/tutorial/application-distribution)、[pnpm 10 deploy](https://pnpm.io/10.x/cli/deploy) 与 [Arch PKGBUILD](https://man.archlinux.org/man/PKGBUILD.5.en)；没有新增 npm 打包器依赖。本机证据见 [首次 Arch 验证记录](../docs/validation/2026-10-27-arch-package.md) 与 [界面更新后的本地安装记录](../docs/validation/2026-10-28-local-install.md)。
