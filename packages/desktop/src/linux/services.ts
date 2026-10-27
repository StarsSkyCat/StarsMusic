import type { MessageBus, Message } from 'dbus-next';
import { capability, desktopEnvironment, type DesktopServices, type PlatformIntegration, type PlaybackPort, type WindowPort } from '../platform.ts';
import { bounded, call, createBus, isSignal, owner, sessionAddress, variant } from './bus.ts';
import { MprisService } from './mpris.ts';

const dbusName = 'org.freedesktop.DBus';
const dbusPath = '/org/freedesktop/DBus';
const portalName = 'org.freedesktop.portal.Desktop';
export const portalPath = '/org/freedesktop/portal/desktop';
export const watcherName = 'org.kde.StatusNotifierWatcher';
export class LinuxServices implements PlatformIntegration {
  #player: PlaybackPort; #window: WindowPort; #env: NodeJS.ProcessEnv;
  #bus: MessageBus | undefined; #mpris: MprisService | undefined;
  #state: DesktopServices; #listeners = new Set<(state: DesktopServices) => void>();
  #refreshing: Promise<DesktopServices> | undefined; #epoch = 0; #disposed = false;
  #timer: ReturnType<typeof setTimeout> | undefined; #poll: ReturnType<typeof setInterval> | undefined;
  constructor(player: PlaybackPort, window: WindowPort, env: NodeJS.ProcessEnv = process.env) {
    this.#player = player; this.#window = window; this.#env = env;
    const initial = capability('unknown', '尚未检测');
    this.#state = { ...desktopEnvironment(env), bus: initial, mpris: initial, notifications: initial, trayHost: initial, portal: initial, globalShortcuts: initial };
  }
  snapshot(): DesktopServices { return structuredClone(this.#state); }
  connection(): MessageBus | undefined { return this.#bus; } // 仅可信后台内部使用。
  setArt(url: string | undefined): void { this.#mpris?.setArt(url); }
  subscribe(listener: (state: DesktopServices) => void): () => void { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; }
  #publish(patch: Partial<DesktopServices>): void {
    if (this.#disposed) return;
    this.#state = { ...this.#state, ...patch }; for (const listener of this.#listeners) listener(this.snapshot());
  }
  #lost(): void {
    const bus = this.#bus; this.#bus = undefined; this.#epoch++;
    this.#mpris?.dispose(); this.#mpris = undefined;
    try { bus?.disconnect(); } catch { /* 连接已断开。 */ }
    const absent = capability('unavailable', '会话 D-Bus 不可用；音频播放不受影响，可重新检测');
    this.#publish({ bus: absent, mpris: absent, notifications: absent, trayHost: absent, portal: absent, globalShortcuts: absent, mprisName: undefined, portalVersion: undefined });
  }
  #signal = (message: Message): void => {
    const services = [portalName, watcherName, 'org.freedesktop.Notifications'];
    const changed = isSignal(message, dbusName, 'NameOwnerChanged') && message.sender === dbusName && services.includes(String(message.body[0]));
    const watcher = message.path === '/StatusNotifierWatcher' && message.interface === watcherName;
    if (!changed && !watcher) return;
    clearTimeout(this.#timer); this.#timer = setTimeout(() => { void this.refresh(); }, 100);
  };
  async initialize(): Promise<void> {
    if (this.#disposed || this.#bus) return;
    const epoch = ++this.#epoch;
    try {
      const bus = createBus(sessionAddress(this.#env, process.getuid?.())); this.#bus = bus;
      bus.on('error', () => { if (this.#bus === bus) this.#lost(); });
      await bounded(new Promise<void>((resolve, reject) => { bus.once('connect', resolve); bus.once('error', reject); }));
      if (this.#disposed || epoch !== this.#epoch || this.#bus !== bus) return;
      this.#publish({ bus: capability('available', '已连接本地会话 D-Bus') });
      const mpris = new MprisService(bus, this.#player, this.#window); this.#mpris = mpris;
      try {
        await bounded(mpris.initialize(this.#player));
        if (epoch === this.#epoch && !this.#disposed) this.#publish({ mpris: capability('available', '已注册 MPRIS 2；媒体键由桌面路由'), mprisName: mpris.name });
      } catch { if (epoch === this.#epoch) this.#publish({ mpris: capability('unavailable', 'MPRIS 名称或接口注册失败') }); }
      bus.on('message', this.#signal);
      await call(bus, dbusName, dbusPath, dbusName, 'AddMatch', 's', ["type='signal',sender='org.freedesktop.DBus',interface='org.freedesktop.DBus',member='NameOwnerChanged'"]);
      await call(bus, dbusName, dbusPath, dbusName, 'AddMatch', 's', ["type='signal',interface='org.kde.StatusNotifierWatcher'"]);
      await this.refresh();
      if (!this.#poll) { this.#poll = setInterval(() => { if (this.#bus) void this.refresh(); }, 30000); this.#poll.unref(); }
    } catch { if (!this.#disposed && epoch === this.#epoch) this.#lost(); }
  }
  refresh(): Promise<DesktopServices> {
    if (this.#refreshing) return this.#refreshing;
    this.#refreshing = this.#probe().finally(() => { this.#refreshing = undefined; }); return this.#refreshing;
  }
  async #probe(): Promise<DesktopServices> {
    const bus = this.#bus; const epoch = this.#epoch;
    if (!bus || this.#disposed) return this.snapshot();
    try { await call(bus, dbusName, dbusPath, dbusName, 'NameHasOwner', 's', [dbusName]); }
    catch { if (epoch === this.#epoch) this.#lost(); return this.snapshot(); }
    const [notifications, tray, portal] = await Promise.allSettled([
      (async () => {
        if (!await owner(bus, 'org.freedesktop.Notifications')) return capability('unavailable', '未检测到通知服务');
        const result = await call(bus, 'org.freedesktop.Notifications', '/org/freedesktop/Notifications', 'org.freedesktop.Notifications', 'GetCapabilities');
        if (!Array.isArray(result[0]) || result[0].some(item => typeof item !== 'string')) throw new Error('desktop.invalid-notification');
        return capability('available', '通知服务已响应；免打扰或桌面策略仍可能隐藏通知');
      })(),
      (async () => {
        if (!await owner(bus, watcherName)) return capability('unavailable', '未检测到 StatusNotifier 托盘宿主');
        const result = await call(bus, watcherName, '/StatusNotifierWatcher', 'org.freedesktop.DBus.Properties', 'Get', 'ss', [watcherName, 'IsStatusNotifierHostRegistered']);
        return variant(result[0], 'b') === true ? capability('available', 'StatusNotifier 宿主已注册；仍需实际创建托盘图标') : capability('unavailable', '有托盘 watcher，但没有显示图标的宿主');
      })(),
      (async () => {
        if (!await owner(bus, portalName)) return { portal: capability('unavailable', '未检测到桌面 portal 服务'), globalShortcuts: capability('unavailable', 'portal 不可用'), portalVersion: undefined };
        try {
          const result = await call(bus, portalName, portalPath, 'org.freedesktop.DBus.Properties', 'Get', 'ss', ['org.freedesktop.portal.GlobalShortcuts', 'version']);
          const version = variant(result[0], 'u'); if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) throw new Error('desktop.invalid-portal');
          return { portal: capability('available', '桌面 portal 已响应'), globalShortcuts: capability('unknown', 'GlobalShortcuts 接口存在，需用户申请后确认绑定结果'), portalVersion: version };
        } catch { return { portal: capability('available', '桌面 portal 已响应'), globalShortcuts: capability('unavailable', '当前 portal 后端未提供可用 GlobalShortcuts 接口'), portalVersion: undefined }; }
      })(),
    ]);
    if (this.#disposed || epoch !== this.#epoch) return this.snapshot();
    this.#publish({ notifications: notifications.status === 'fulfilled' ? notifications.value : capability('unknown', '通知服务未能响应'),
      trayHost: tray.status === 'fulfilled' ? tray.value : capability('unknown', '无法确认托盘宿主状态'),
      ...(portal.status === 'fulfilled' ? portal.value : { portal: capability('unknown', '无法确认 portal 状态'), globalShortcuts: capability('unknown', '无法确认 portal 快捷键能力'), portalVersion: undefined }) });
    return this.snapshot();
  }
  async dispose(): Promise<void> {
    if (this.#disposed) return; this.#disposed = true; this.#epoch++;
    clearTimeout(this.#timer); clearInterval(this.#poll); this.#listeners.clear(); this.#mpris?.dispose(); this.#mpris = undefined;
    const bus = this.#bus; this.#bus = undefined; bus?.removeListener('message', this.#signal); try { bus?.disconnect(); } catch { /* 已断开。 */ }
  }
}
