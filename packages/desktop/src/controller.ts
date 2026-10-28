import type { MessageBus } from 'dbus-next';
import { appError, type AppError } from '../../contracts/src/errors.ts';
import { parseSystemSnapshot, parseSystemArguments, systemChannels, type SystemSnapshot, type SystemPreferenceKey, type ShortcutBinding, type ShortcutId, type Capability } from '../../contracts/src/system.ts';
import { LinuxServices } from './linux/services.ts';
import { PortalShortcuts } from './linux/portal-shortcuts.ts';
import { LinuxNotifications } from './linux/notifications.ts';
import { capability, adjacent, togglePlayback, type PlaybackPort, type PresentationPort, type DesktopServices } from './platform.ts';
import { DesktopCoverCache } from './cover-cache.ts';
import { DesktopSettings } from './settings.ts';
import { shortcuts, windowShortcut, type ShortcutInput } from './shortcuts.ts';
import type { DesktopRuntime, TrayPort } from './runtime.ts';
import { windowsDesktop } from './windows/platform.ts';

export interface DesktopServicePort {
  initialize(): Promise<void>; snapshot(): DesktopServices; subscribe(listener: (state: DesktopServices) => void): () => void;
  connection(): MessageBus | undefined; refresh(): Promise<DesktopServices>; setArt(url: string | undefined): void; dispose(): Promise<void>;
}
export class DesktopController {
  #platform: string; #player: PlaybackPort; #presentation: PresentationPort; #runtime: DesktopRuntime; #settings: DesktopSettings;
  #services: DesktopServicePort | undefined; #raw: DesktopServices;
  #revision = 0; #listeners = new Set<(state: SystemSnapshot) => void>(); #unsubscribe: (() => void)[] = [];
  #tray: TrayPort | undefined; #trayStatus = capability('unknown', '尚未创建托盘图标');
  #notifications: LinuxNotifications | undefined; #notificationBus: MessageBus | undefined; #notificationStatus: Capability | undefined;
  #shortcutsStatus = capability('disabled', '全局快捷键未启用；窗口内快捷键可用');
  #bindings: ShortcutBinding[] = []; #shortcutKey = ''; #shortcutEpoch = 0; #portal: PortalShortcuts | undefined; #registered: string[] = [];
  #cover = new DesktopCoverCache(); #coverEpoch = 0; #disposed = false; #error: AppError | undefined;
  #notified = ''; #previousAction: { id: ShortcutId; source: string; time: number } | undefined;
  #initializing: Promise<void> | undefined;
  #writes: Promise<unknown> = Promise.resolve();
  constructor(player: PlaybackPort, presentation: PresentationPort, runtime: DesktopRuntime, settings: DesktopSettings, platform = process.platform, services?: DesktopServicePort) {
    this.#platform = platform; this.#player = player; this.#presentation = presentation; this.#runtime = runtime; this.#settings = settings;
    this.#services = platform === 'linux' ? services ?? new LinuxServices(player, runtime) : undefined;
    const unsupported = capability('unavailable', '此平台的系统适配尚未实现');
    this.#raw = this.#services?.snapshot() ?? (platform === 'win32' ? windowsDesktop() : { session: 'unknown', desktop: '未适配', bus: unsupported, mpris: unsupported, notifications: unsupported, trayHost: unsupported, portal: unsupported, globalShortcuts: unsupported });
    this.#bindings = this.#defaultBindings('disabled');
  }
  #defaultBindings(state: ShortcutBinding['state']): ShortcutBinding[] { return shortcuts.map(shortcut => ({ id: shortcut.id, label: shortcut.label, accelerator: shortcut.accelerator, state })); }
  snapshot(): SystemSnapshot {
    const raw = this.#raw;
    return parseSystemSnapshot({ revision: this.#revision, platform: this.#platform, session: raw.session, desktop: raw.desktop, bus: raw.bus, mpris: raw.mpris,
      notifications: this.#notificationStatus ?? raw.notifications, tray: this.#trayStatus, portal: raw.portal, shortcuts: this.#shortcutsStatus,
      bindings: this.#bindings, preferences: this.#settings.snapshot(), ...(raw.mprisName ? { mprisName: raw.mprisName } : {}),
      ...(raw.portalVersion === undefined ? {} : { portalVersion: raw.portalVersion }), ...(this.#error ? { error: this.#error } : {}) });
  }
  subscribe(listener: (state: SystemSnapshot) => void): () => void { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  #publish(): void { if (this.#disposed) return; this.#revision++; const state = this.snapshot(); for (const listener of this.#listeners) listener(state); }
  initialize(): Promise<void> { return this.#initializing ??= this.#initialize(); }
  async #initialize(): Promise<void> {
    if (!await this.#settings.initialize()) this.#error = appError('desktop-save-failed');
    if (this.#disposed) return;
    this.#unsubscribe.push(this.#player.subscribe(() => this.#playback()), this.#presentation.subscribe(() => { void this.#artwork(); }));
    if (this.#services) {
      this.#unsubscribe.push(this.#services.subscribe(state => { this.#raw = state; this.#surfaces(); }));
      await this.#services.initialize(); this.#raw = this.#services.snapshot();
    }
    this.#surfaces(); void this.#artwork(); this.#publish();
  }
  #surfaces(): void {
    if (this.#disposed) return;
    const preferences = this.#settings.snapshot(); const raw = this.#raw; const wasTrayReady = this.#trayStatus.state === 'available';
    if (preferences.tray && (this.#platform === 'win32' || (this.#platform === 'linux' && raw.trayHost.state === 'available'))) {
      try {
        this.#tray ??= this.#runtime.createTray(id => {
          if (this.#disposed) return;
          if (id === 'quit') this.#runtime.quit(); else if (id === 'hide') this.#runtime.hide(); else this.#action(id, 'tray');
        });
        this.#tray.update(this.#player.snapshot());
        this.#trayStatus = this.#platform === 'win32'
          ? capability('available', 'Windows 托盘图标已创建；可能位于通知区域的折叠菜单中')
          : raw.trayRegistered ? capability('available', '已确认本进程图标在 StatusNotifier 宿主注册；请确认桌面上是否可见') : capability('unknown', '图标已创建，尚未确认宿主接收；关闭窗口仍会退出');
      } catch { this.#tray?.destroy(); this.#tray = undefined; this.#trayStatus = capability('unavailable', '托盘图标创建失败；关闭窗口仍可退出'); }
    } else {
      const hadTray = !!this.#tray; this.#tray?.destroy(); this.#tray = undefined;
      this.#trayStatus = preferences.tray ? raw.trayHost : capability('disabled', '托盘已关闭');
      if (hadTray && !this.#runtime.isVisible()) this.#runtime.show();
    }
    if (wasTrayReady && this.#trayStatus.state !== 'available' && !this.#runtime.isVisible()) this.#runtime.show();
    const bus = this.#services?.connection();
    if (bus !== this.#notificationBus || raw.notifications.state !== 'available') {
      const old = this.#notifications; this.#notifications = undefined; this.#notificationBus = undefined; void old?.dispose();
      this.#notificationStatus = undefined;
    }
    if (bus && raw.notifications.state === 'available' && !this.#notifications) { this.#notifications = new LinuxNotifications(bus, () => this.#runtime.show()); this.#notificationBus = bus; }
    this.#configureShortcuts(); this.#publish();
  }
  #configureShortcuts(force = false): void {
    const enabled = this.#settings.snapshot().globalShortcuts; const raw = this.#raw;
    const key = JSON.stringify([enabled, this.#platform, raw.session, raw.bus.state, raw.portalVersion, raw.portalOwner, raw.globalShortcuts.state]);
    if (!force && key === this.#shortcutKey) return; this.#shortcutKey = key;
    const epoch = ++this.#shortcutEpoch; const old = this.#portal; this.#portal = undefined; void old?.dispose();
    for (const accelerator of this.#registered) this.#runtime.unregisterShortcut(accelerator); this.#registered = [];
    this.#bindings = this.#defaultBindings(enabled ? 'unavailable' : 'disabled');
    if (!enabled) { this.#shortcutsStatus = capability('disabled', '全局快捷键未启用；窗口内快捷键可用'); return; }
    if (this.#platform !== 'linux' && this.#platform !== 'win32') { this.#shortcutsStatus = capability('unavailable', '此平台的全局快捷键适配尚未实现'); return; }
    if (this.#platform === 'win32' || raw.session === 'x11') {
      this.#bindings = shortcuts.map(shortcut => {
        let registered = false;
        try { registered = this.#runtime.registerShortcut(shortcut.accelerator, () => this.#action(shortcut.id, 'global')); } catch { /* 冲突或系统拒绝。 */ }
        if (registered) this.#registered.push(shortcut.accelerator);
        return { id: shortcut.id, label: shortcut.label, accelerator: shortcut.accelerator, state: registered ? 'available' : 'unavailable' };
      });
      this.#shortcutsStatus = this.#bindingStatus(`${this.#platform === 'win32' ? 'Windows' : 'X11'} 已接受快捷键注册；实际按键响应仍由桌面决定`); return;
    }
    const bus = this.#services?.connection();
    if (raw.session !== 'wayland' || !bus || !raw.portalVersion || raw.globalShortcuts.state === 'unavailable') {
      this.#shortcutsStatus = capability('unavailable', raw.session === 'unknown' ? '无法确认会话类型；保留窗口内快捷键' : '当前 Wayland portal 不提供可用全局快捷键；保留窗口内快捷键'); return;
    }
    this.#bindings = this.#defaultBindings('pending'); this.#shortcutsStatus = capability('pending', '等待 portal 授权与绑定确认，可在此关闭取消申请');
    const portal = new PortalShortcuts(bus, id => this.#action(id, 'global'), () => {
      if (epoch !== this.#shortcutEpoch || this.#disposed) return;
      this.#bindings = this.#defaultBindings('unavailable'); this.#shortcutsStatus = capability('unavailable', 'portal 已关闭快捷键会话，请重新检测后申请');
      this.#publish();
    }); this.#portal = portal;
    void portal.initialize().then(bindings => {
      if (this.#disposed || epoch !== this.#shortcutEpoch) return;
      this.#bindings = bindings; this.#shortcutsStatus = this.#bindingStatus('portal 已确认绑定；可用快捷键以桌面授权结果为准'); this.#publish();
    }).catch(() => {
      if (this.#disposed || epoch !== this.#shortcutEpoch) return;
      this.#bindings = this.#defaultBindings('unavailable'); this.#shortcutsStatus = capability('unavailable', 'portal 未确认绑定（取消、拒绝、超时或会话不可用）；窗口内快捷键仍可用');
      this.#portal = undefined; void portal.dispose(); this.#publish();
    });
  }
  #bindingStatus(detail: string): Capability {
    const count = this.#bindings.filter(binding => binding.state === 'available').length;
    return capability(count === shortcuts.length ? 'available' : count ? 'unknown' : 'unavailable', count === shortcuts.length ? detail : `已确认 ${count}/${shortcuts.length} 个绑定；其余使用窗口内快捷键`);
  }
  #action(id: ShortcutId, source: string): void {
    if (this.#disposed) return;
    const previous = this.#previousAction; const now = performance.now();
    const sharedKeyEvent = previous && ((previous.source === 'window' && source === 'global') || (previous.source === 'global' && source === 'window'));
    if (previous?.id === id && sharedKeyEvent && now - previous.time < 250) return;
    this.#previousAction = { id, source, time: now };
    if (id === 'show') { this.#runtime.show(); return; }
    const state = this.#player.snapshot();
    const operation = id === 'toggle' ? togglePlayback(this.#player) : id === 'next' ? adjacent(this.#player, 1) : id === 'previous' ? adjacent(this.#player, -1) : this.#player.setMuted(!(state.muted || state.volume === 0));
    void operation.catch(() => undefined);
  }
  handleInput(input: ShortcutInput): boolean { const id = windowShortcut(input); if (!id || this.#disposed) return false; this.#action(id, 'window'); return true; }
  shouldHideOnClose(): boolean { const preferences = this.#settings.snapshot(); return !this.#disposed && preferences.tray && preferences.closeToTray && !!this.#tray && this.#trayStatus.state === 'available' && (this.#platform === 'win32' || this.#raw.trayHost.state === 'available'); }
  async setPreference(key: SystemPreferenceKey, enabled: boolean): Promise<SystemSnapshot> {
    parseSystemArguments(systemChannels.setPreference, [key, enabled]);
    await this.#initializing;
    const pending = this.#writes.catch(() => undefined).then(async () => {
      if (this.#disposed) return;
      const previous = this.#settings.snapshot();
      try {
        const next = { ...previous, [key]: enabled };
        if (key === 'tray' && !enabled) next.closeToTray = false;
        if (key === 'closeToTray' && enabled && (!this.#tray || this.#trayStatus.state !== 'available')) { this.#error = appError('unsupported'); this.#publish(); return; }
        await this.#settings.write(next);
        if (this.#disposed) return; this.#error = undefined;
        if (key === 'globalShortcuts') this.#shortcutKey = '';
        if (key === 'notifications' && !enabled) { const old = this.#notifications; this.#notifications = undefined; this.#notificationBus = undefined; await old?.dispose(); }
        this.#surfaces();
      } catch { if (!this.#disposed) { this.#error = appError('desktop-save-failed'); this.#publish(); } }
    }); this.#writes = pending; await pending; return this.snapshot();
  }
  async refresh(): Promise<SystemSnapshot> {
    await this.#initializing;
    if (this.#disposed) return this.snapshot(); this.#notificationStatus = undefined; this.#shortcutKey = '';
    if (this.#services) {
      if (this.#raw.bus.state !== 'available') await this.#services.initialize();
      this.#raw = await this.#services.refresh();
    }
    this.#surfaces(); this.#publish(); return this.snapshot();
  }
  async testNotification(): Promise<SystemSnapshot> {
    await this.#initializing;
    if (this.#disposed) return this.snapshot();
    if (!this.#notifications) this.#notificationStatus = capability('unavailable', '未检测到可用通知服务，未发送测试通知');
    else {
      try {
        const sent = await this.#notifications.send('StarsMusic 桌面通知', '通知服务已接收测试请求。点击通知可打开主窗口。', () => !this.#disposed);
        if (sent) this.#notificationStatus = capability('available', '通知服务已接收测试请求；免打扰或桌面策略可能隐藏通知');
      } catch { this.#notificationStatus = capability('unavailable', '通知发送失败；音频播放不受影响'); }
    }
    this.#publish(); return this.snapshot();
  }
  #playback(): void {
    if (this.#disposed) return;
    const state = this.#player.snapshot();
    try { this.#tray?.update(state); } catch {
      try { this.#tray?.destroy(); } catch { /* 宿主已丢失。 */ } this.#tray = undefined;
      this.#trayStatus = capability('unavailable', '托盘更新失败，已保留主窗口退出路径');
      if (!this.#runtime.isVisible()) this.#runtime.show(); this.#publish();
    }
    const track = state.queue[state.currentIndex ?? -1]; const key = `${state.generation}:${track?.id ?? ''}`;
    if (state.status !== 'playing' || !track || key === this.#notified) return;
    this.#notified = key;
    if (!this.#settings.snapshot().notifications || this.#runtime.isVisible() || !this.#notifications) return;
    void this.#notifications.send(track.title, track.artist ?? '正在播放', () => !this.#disposed && this.#settings.snapshot().notifications && this.#player.snapshot().generation === state.generation)
      .catch(() => { this.#notificationStatus = capability('unavailable', '后台切歌通知发送失败'); this.#publish(); });
  }
  async #artwork(): Promise<void> {
    if (this.#disposed || !this.#services) return;
    const epoch = ++this.#coverEpoch; const playback = this.#player.snapshot();
    try {
      const url = await this.#cover.update(this.#presentation.snapshot(), playback);
      if (!this.#disposed && epoch === this.#coverEpoch && playback.generation === this.#player.snapshot().generation) this.#services.setArt(url);
    } catch { /* 封面存储不可用时保留文字媒体信息。 */ }
  }
  async dispose(): Promise<void> {
    if (this.#disposed) return; this.#disposed = true; this.#shortcutEpoch++; this.#coverEpoch++;
    for (const unsubscribe of this.#unsubscribe) unsubscribe(); this.#unsubscribe = []; this.#listeners.clear();
    this.#tray?.destroy(); this.#tray = undefined; for (const accelerator of this.#registered) this.#runtime.unregisterShortcut(accelerator); this.#registered = [];
    await Promise.allSettled([this.#portal?.dispose(), this.#notifications?.dispose(), this.#cover.dispose(), this.#writes]);
    await this.#services?.dispose(); await this.#settings.close();
  }
}
