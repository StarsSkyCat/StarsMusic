# 窗口控制与跨平台适配准备

日期：2026-10-28。开发机：Arch Linux x86_64、niri / Wayland 与 XWayland、Electron 45。本轮完成窗口控制实现和 Linux 验证，不代表 Windows/macOS 已适配验收。

## 实现

- Linux/Windows 使用无边框窗口，右上角提供最小化、最大化/还原、关闭。图标跟随真实窗口最大化/全屏状态更新；系统外部操作也同步。按钮默认透明，悬停显示背景，关闭悬停为红色；支持键盘焦点和中文可访问名称。
- 沿用现有顶部栏高度，页面滚动时标题栏粘顶；空白区域可拖动，搜索框、按钮、表单等明确设为 no-drag。未把页面点击位置转换为主进程任意坐标操作。
- `packages/contracts/src/window.ts` 声明 `getState/minimize/toggleMaximize/close/onChanged` 白名单。状态仅投影平台、最大化、全屏和焦点布尔值，不暴露窗口句柄、任意窗口 ID 或 Electron 对象。主进程校验当前窗口、精确主文档及无参输入，监听器可取消。
- 通用窗口适配位于 `packages/desktop/src/window-controls.ts`。macOS 使用 hiddenInset 保留原生红黄绿按钮并预留左上角位置，页面不重复绘制右上角按钮；实际布局和行为仍需 macOS 实机验证。Windows 原生贴靠菜单、系统主题和触摸矩阵也未验证。
- 关闭按钮调用原生 close 生命周期：默认关闭退出并清理音频/后台进程；用户启用关闭到托盘且宿主实际可用时隐藏窗口，继续沿用原有恢复/退出入口。未把关闭按钮改成无条件隐藏。

标题栏与拖动区域配置核对 [Electron 自定义标题栏](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar) 和 [自定义窗口交互](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)。没有引入新依赖或复制视觉资产。

## 已执行验证

- `pnpm typecheck`、`pnpm test`：严格类型检查与 142 项单元测试通过，包含窗口契约白名单、非法参数、状态投影、最大化/还原、退出全屏及平台配置。
- `pnpm test:e2e`：16 项实际 Electron 桌面测试通过。新增测试实际点击最小化、最大化/还原和关闭，检查 BrowserWindow 原生状态；外部最大化事件可更新图标，滚动到设置底部后关闭按钮仍在视口内。
- 最终窗口专项测试重新构建后通过，在浅色/暗色各 960×640 窗口检查搜索、账号与窗口按钮互不覆盖、搜索仍能输入和清空、drag/no-drag 区域正确；截图仅使用临时匿名配置。
- 既有 Linux 独立总线合成托盘测试改为实际点击关闭按钮，验证关闭到托盘、恢复与宿主丢失后的窗口恢复；实际 mpv/系统音频播放与退出清理仍由完整桌面回归覆盖。

## 独立包与宿主差异

已从干净源码 `b0e9f3c1` 构建 `starsmusic-0.0.0.r60.gb0e9f3c1-1-x86_64.pkg.tar.zst`，SHA-256 为 `157198272934562fa156fcf72a144c159f86e9ce6e8837d7103ccafe952f0985`。包内白名单部署审计 5045 个运行文件，不包含登录数据、密钥或测试截图。

独立包在 Wayland 下实际点击最小化、最大化/还原和关闭均通过，窗口事件与按钮状态同步；匿名后台、PipeWire、MPRIS、单实例也通过。当前 niri 的 XWayland 环境中，按钮与直接调用 Electron 原生 minimize/maximize 均不产生窗口状态变化，不能宣称这两个动作通过；真实状态未改变时图标仍为最大化。X11 下关闭、匿名后台、PipeWire、MPRIS 和单实例通过。打包测试会单独报告原生宿主忽略操作，原生接口若有效但按钮无效仍判失败，不把 UI 故障归入宿主限制。

已用 pacman 升级本机安装，再次运行 `pnpm test:package /opt/starsmusic/starsmusic`。Wayland 的最小化、最大化/还原、关闭及播放/系统集成均通过；X11 下仍明确报告上述原生宿主限制，关闭及其余检查通过。`pacman -Qk starsmusic` 验证 5615 个文件、缺失 0，安装元数据指向干净源码 `b0e9f3c1934b5ca6969329d546facd91c42f9c8a`。未关闭用户现有窗口、读取真实登录数据或修改其队列，旧进程需要重启生效。

真实 Windows/macOS、其他 Linux 桌面/发行版及完整原生拖动手势矩阵尚未验证。
