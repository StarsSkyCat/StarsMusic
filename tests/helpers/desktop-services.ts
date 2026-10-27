// 仅用于 dbus-run-session 隔离总线的合成服务，不导入产品代码或运行于用户真实 session bus。
import dbus from 'dbus-next';
import type { Message, MessageBus } from 'dbus-next';
import { setTimeout as delay } from 'node:timers/promises';
const { Interface } = dbus.interface;
const portalPath = '/org/freedesktop/portal/desktop'; const portal = 'org.freedesktop.portal.GlobalShortcuts';
class FakePortal extends Interface { constructor() { super(portal); } get version() { return 2; } }
FakePortal.configureMembers({ properties: { version: { signature: 'u', access: 'read' } } });
class FakeWatcher extends Interface {
  host = true; items: string[] = []; #sender: () => string;
  constructor(sender: () => string) { super('org.kde.StatusNotifierWatcher'); this.#sender = sender; }
  get IsStatusNotifierHostRegistered() { return this.host; } get RegisteredStatusNotifierItems() { return this.items; } get ProtocolVersion() { return 0; }
  RegisterStatusNotifierItem(service: string): void { const item = service.startsWith('/') ? `${this.#sender()}${service}` : service; this.items.push(item); this.StatusNotifierItemRegistered(item); }
  RegisterStatusNotifierHost(): void {}
  StatusNotifierItemRegistered(item: string): string { return item; }
  StatusNotifierHostRegistered(): void {} StatusNotifierHostUnregistered(): void {}
  setHost(host: boolean): void { this.host = host; Interface.emitPropertiesChanged(this, { IsStatusNotifierHostRegistered: host }, []); if (host) this.StatusNotifierHostRegistered(); else this.StatusNotifierHostUnregistered(); }
}
FakeWatcher.configureMembers({ properties: { IsStatusNotifierHostRegistered: { signature: 'b', access: 'read' }, RegisteredStatusNotifierItems: { signature: 'as', access: 'read' }, ProtocolVersion: { signature: 'i', access: 'read' } },
  methods: { RegisterStatusNotifierItem: { inSignature: 's' }, RegisterStatusNotifierHost: { inSignature: 's' } }, signals: { StatusNotifierItemRegistered: { signature: 's' }, StatusNotifierHostRegistered: { signature: '' }, StatusNotifierHostUnregistered: { signature: '' } } });
export interface ReceivedNotification { id: number; title: string; body: string; actions: string[]; hints: Record<string, dbus.Variant> }
class FakeNotifications extends Interface {
  received: ReceivedNotification[] = []; closed: number[] = []; #sequence = 40;
  constructor() { super('org.freedesktop.Notifications'); }
  GetCapabilities(): string[] { return ['body', 'body-markup', 'actions']; }
  GetServerInformation(): string[] { return ['Synthetic desktop test service', 'StarsMusic tests', '1', '1.2']; }
  Notify(_app: string, replaces: number, _icon: string, title: string, body: string, actions: string[], hints: Record<string, dbus.Variant>, _expiry: number): number {
    const id = replaces || ++this.#sequence; this.received.push({ id, title, body, actions, hints }); return id;
  }
  CloseNotification(id: number): void { this.closed.push(id); this.NotificationClosed(id, 3); }
  ActionInvoked(id: number, action: string): [number, string] { return [id, action]; }
  NotificationClosed(id: number, reason: number): [number, number] { return [id, reason]; }
}
FakeNotifications.configureMembers({ methods: { GetCapabilities: { outSignature: 'as' }, GetServerInformation: { outSignature: 'ssss' }, Notify: { inSignature: 'susssasa{sv}i', outSignature: 'u' }, CloseNotification: { inSignature: 'u' } },
  signals: { ActionInvoked: { signature: 'us' }, NotificationClosed: { signature: 'uu' } } });

export class SyntheticDesktopServices {
  readonly bus: MessageBus; readonly watcher: FakeWatcher; readonly notifications = new FakeNotifications();
  mode: 'success' | 'denied' | 'pending' = 'success'; allowed = ['toggle', 'previous', 'next', 'mute', 'show'];
  closeAfterBind = false;
  requests = 0; closedRequests = 0; closedSessions: string[] = []; sessions: string[] = []; pendingResponses: (() => void)[] = [];
  #sender = ''; #disposed = false;
  constructor(bus: MessageBus, isolated = process.env.STARSMUSIC_TEST_BUS === 'isolated') {
    if (!isolated) throw new Error('合成桌面服务只能在显式隔离测试中使用');
    this.bus = bus; this.watcher = new FakeWatcher(() => this.#sender);
    bus.on('error', () => undefined);
    bus.on('message', message => { if (message.interface === 'org.kde.StatusNotifierWatcher') this.#sender = message.sender; });
  }
  async initialize(): Promise<void> {
    for (const name of ['org.freedesktop.portal.Desktop', 'org.kde.StatusNotifierWatcher', 'org.freedesktop.Notifications']) {
      let acquired = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const reply = await this.bus.requestName(name, dbus.NameFlag.DO_NOT_QUEUE);
        if (reply === dbus.RequestNameReply.PRIMARY_OWNER || reply === dbus.RequestNameReply.ALREADY_OWNER) { acquired = true; break; }
        await delay(10);
      }
      if (!acquired) throw new Error('隔离测试总线名称被占用');
    }
    this.bus.export(portalPath, new FakePortal()); this.bus.export('/StatusNotifierWatcher', this.watcher);
    this.bus.export('/org/freedesktop/Notifications', this.notifications); this.bus.addMethodHandler(this.#handle);
  }
  #handle = (message: Message): boolean => {
    if (message.type !== dbus.MessageType.METHOD_CALL) return false;
    if (message.interface === portal && message.path === portalPath && ['CreateSession', 'BindShortcuts'].includes(message.member)) {
      const options = message.body.at(-1) as Record<string, dbus.Variant>;
      const token = options.handle_token?.value as string; const sender = message.sender.slice(1).replaceAll('.', '_');
      const handle = `/org/freedesktop/portal/desktop/request/${sender}/${token}`;
      let results: Record<string, dbus.Variant>;
      if (message.member === 'CreateSession') {
        const session = `/org/freedesktop/portal/desktop/session/${sender}/${options.session_handle_token!.value}`; this.sessions.push(session);
        results = { session_handle: new dbus.Variant('s', session) };
      } else {
        this.requests++;
        results = { shortcuts: new dbus.Variant('a(sa{sv})', this.allowed.map(id => [id, { trigger_description: new dbus.Variant('s', `Synthetic accepted ${id}`) }])) };
      }
      const respond = () => { if (!this.#disposed) this.bus.send(dbus.Message.newSignal(handle, 'org.freedesktop.portal.Request', 'Response', 'ua{sv}', [this.mode === 'denied' && message.member === 'BindShortcuts' ? 1 : 0, results])); };
      // 特意先发 Response，再返回 method handle，验证订阅竞态。
      if (this.mode === 'pending' && message.member === 'BindShortcuts') this.pendingResponses.push(respond); else respond();
      if (this.closeAfterBind && message.member === 'BindShortcuts') this.closeSession(String(message.body[0]));
      this.bus.send(dbus.Message.newMethodReturn(message, 'o', [handle])); return true;
    }
    if (message.interface === 'org.freedesktop.portal.Request' && message.member === 'Close') { this.closedRequests++; this.bus.send(dbus.Message.newMethodReturn(message)); return true; }
    if (message.interface === 'org.freedesktop.portal.Session' && message.member === 'Close') { this.closedSessions.push(message.path); this.bus.send(dbus.Message.newMethodReturn(message)); return true; }
    return false;
  };
  activate(id: string, session = this.sessions.at(-1)!): void { this.bus.send(dbus.Message.newSignal(portalPath, portal, 'Activated', 'osta{sv}', [session, id, 1n, {}])); }
  closeSession(session = this.sessions.at(-1)!): void { this.bus.send(dbus.Message.newSignal(session, 'org.freedesktop.portal.Session', 'Closed', 'a{sv}', [{}])); }
  async dispose(): Promise<void> { if (this.#disposed) return; this.#disposed = true; this.bus.removeMethodHandler(this.#handle); this.bus.disconnect(); }
}
