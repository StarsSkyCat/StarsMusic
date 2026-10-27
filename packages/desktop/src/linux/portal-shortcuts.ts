import dbus from 'dbus-next';
import type { MessageBus, Message } from 'dbus-next';
import { randomUUID } from 'node:crypto';
import type { ShortcutBinding, ShortcutId } from '../../../contracts/src/system.ts';
import { shortcuts } from '../shortcuts.ts';
import { call, owner, variant, isSignal } from './bus.ts';
import { portalPath } from './services.ts';
const destination = 'org.freedesktop.portal.Desktop'; const iface = 'org.freedesktop.portal.GlobalShortcuts';
interface Request { handle: string; cancel: () => void }
export class PortalShortcuts {
  #bus: MessageBus; #activate: (id: ShortcutId) => void; #closed: () => void;
  #owner: string | undefined; #session: string | undefined; #disposed = false; #sessionClosed = false; #bound = new Set<ShortcutId>(); #requests = new Set<Request>();
  constructor(bus: MessageBus, activate: (id: ShortcutId) => void, closed: () => void) { this.#bus = bus; this.#activate = activate; this.#closed = closed; }
  #signal = (message: Message): void => {
    if (this.#disposed || this.#sessionClosed || message.sender !== this.#owner) return;
    if (isSignal(message, 'org.freedesktop.portal.Session', 'Closed') && message.path === this.#session) { this.#sessionClosed = true; this.#bound.clear(); for (const request of this.#requests) request.cancel(); this.#closed(); return; }
    if (!isSignal(message, iface, 'Activated') || message.path !== portalPath || message.body[0] !== this.#session) return;
    const id = shortcuts.find(shortcut => shortcut.id === message.body[1])?.id;
    if (id && this.#bound.has(id)) this.#activate(id);
  };
  async #request(member: string, signature: string, body: unknown[], options: Record<string, dbus.Variant>): Promise<Record<string, unknown>> {
    if (this.#disposed || !this.#owner) throw new Error('desktop.portal-cancelled');
    const token = `starsmusic_${randomUUID().replaceAll('-', '')}`;
    const name: unknown = Reflect.get(this.#bus, 'name'); if (typeof name !== 'string' || !/^:\d+\.\d+$/.test(name)) throw new Error('desktop.portal-name');
    const prefix = `/org/freedesktop/portal/desktop/request/${name.slice(1).replaceAll('.', '_')}/`;
    let handle = `${prefix}${token}`;
    const match = `type='signal',sender='${this.#owner}',interface='org.freedesktop.portal.Request',member='Response'`;
    await call(this.#bus, 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'AddMatch', 's', [match]);
    if (this.#disposed) throw new Error('desktop.portal-cancelled');
    let finish!: (value: Record<string, unknown>) => void; let reject!: (error: Error) => void;
    const response = new Promise<Record<string, unknown>>((resolve, fail) => { finish = resolve; reject = fail; });
    const request = { handle, cancel: () => reject(new Error('desktop.portal-cancelled')) }; this.#requests.add(request);
    const receive = (message: Message): void => {
      if (message.sender !== this.#owner || message.path !== handle || !isSignal(message, 'org.freedesktop.portal.Request', 'Response')) return;
      if (message.body[0] !== 0 || typeof message.body[1] !== 'object' || message.body[1] === null) { reject(new Error('desktop.portal-denied')); return; }
      finish(message.body[1] as Record<string, unknown>);
    };
    this.#bus.on('message', receive);
    const timeout = setTimeout(() => reject(new Error('desktop.portal-unconfirmed')), 45000);
    let completed = false;
    try {
      const [result, values] = await Promise.all([
        call(this.#bus, destination, portalPath, iface, member, signature, [...body, { ...options, handle_token: new dbus.Variant('s', token) }]).then(reply => {
          const actual = reply[0]; if (typeof actual !== 'string' || !actual.startsWith(prefix) || !/^[A-Za-z0-9_]+$/.test(actual.slice(prefix.length))) throw new Error('desktop.portal-handle');
          handle = actual; request.handle = actual; return actual;
        }), response,
      ]);
      void result; completed = true; return values;
    } finally {
      clearTimeout(timeout); this.#bus.removeListener('message', receive); this.#requests.delete(request);
      if (!completed) void call(this.#bus, destination, handle, 'org.freedesktop.portal.Request', 'Close').catch(() => undefined);
      void call(this.#bus, 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RemoveMatch', 's', [match]).catch(() => undefined);
    }
  }
  async initialize(): Promise<ShortcutBinding[]> {
    this.#owner = await owner(this.#bus, destination); if (!this.#owner || this.#disposed) throw new Error('desktop.portal-unavailable');
    for (const signalInterface of [iface, 'org.freedesktop.portal.Session']) await call(this.#bus, 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'AddMatch', 's', [`type='signal',sender='${this.#owner}',interface='${signalInterface}'`]);
    if (this.#disposed) throw new Error('desktop.portal-cancelled');
    this.#bus.on('message', this.#signal);
    const sessionToken = `starsmusic_${randomUUID().replaceAll('-', '')}`;
    const created = await this.#request('CreateSession', 'a{sv}', [], { session_handle_token: new dbus.Variant('s', sessionToken) });
    const handle = variant(created.session_handle, 's');
    if (typeof handle !== 'string' || !/^\/org\/freedesktop\/portal\/desktop\/session\/[A-Za-z0-9_]+\/[A-Za-z0-9_]+$/.test(handle)) throw new Error('desktop.portal-session');
    if (this.#disposed) { void call(this.#bus, destination, handle, 'org.freedesktop.portal.Session', 'Close').catch(() => undefined); throw new Error('desktop.portal-cancelled'); }
    this.#session = handle;
    const result = await this.#request('BindShortcuts', 'oa(sa{sv})sa{sv}', [handle, shortcuts.map(shortcut => [shortcut.id, { description: new dbus.Variant('s', shortcut.label), preferred_trigger: new dbus.Variant('s', shortcut.trigger) }]), ''], {});
    const values = variant(result.shortcuts, 'a(sa{sv})'); if (!Array.isArray(values) || values.length > shortcuts.length) throw new Error('desktop.portal-bindings');
    const bound = new Map<ShortcutId, string>();
    for (const row of values) {
      if (!Array.isArray(row) || row.length !== 2) throw new Error('desktop.portal-binding');
      const id = shortcuts.find(shortcut => shortcut.id === row[0])?.id;
      if (!id || bound.has(id) || typeof row[1] !== 'object' || row[1] === null) throw new Error('desktop.portal-binding');
      const description = Reflect.get(row[1], 'trigger_description') as unknown;
      const trigger = description === undefined ? '' : variant(description, 's');
      if (typeof trigger !== 'string' || trigger.length > 200) throw new Error('desktop.portal-trigger');
      bound.set(id, trigger);
    }
    if (this.#disposed || this.#sessionClosed) throw new Error('desktop.portal-cancelled'); this.#bound = new Set(bound.keys());
    return shortcuts.map(shortcut => ({ id: shortcut.id, label: shortcut.label, accelerator: shortcut.accelerator, state: bound.has(shortcut.id) ? 'available' : 'unavailable', ...(bound.get(shortcut.id) ? { trigger: bound.get(shortcut.id)! } : {}) }));
  }
  async dispose(): Promise<void> {
    if (this.#disposed) return; this.#disposed = true; this.#bound.clear(); this.#bus.removeListener('message', this.#signal);
    const requests = [...this.#requests]; for (const request of requests) request.cancel();
    await Promise.allSettled(requests.map(request => call(this.#bus, destination, request.handle, 'org.freedesktop.portal.Request', 'Close')));
    if (this.#session) await call(this.#bus, destination, this.#session, 'org.freedesktop.portal.Session', 'Close').catch(() => undefined);
    if (this.#owner) await Promise.allSettled([iface, 'org.freedesktop.portal.Session'].map(signalInterface => call(this.#bus, 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RemoveMatch', 's', [`type='signal',sender='${this.#owner}',interface='${signalInterface}'`])));
    this.#session = undefined;
  }
}
