import dbus from 'dbus-next';
import type { MessageBus, Message } from 'dbus-next';

export async function bounded<T>(operation: Promise<T>, ms = 2500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('desktop.timeout')), ms); })]); }
  finally { clearTimeout(timer); }
}
// 仅连接本地 Unix session bus；不允许 unixexec/TCP，不读取 renderer 参数或启动额外命令。
export function sessionAddress(env: NodeJS.ProcessEnv, uid: number | undefined): string {
  const address = env.DBUS_SESSION_BUS_ADDRESS ?? (uid === undefined ? '' : `unix:path=/run/user/${uid}/bus`);
  for (const candidate of address.split(';')) {
    if (!candidate.startsWith('unix:')) continue;
    const params = new Map(candidate.slice(5).split(',').map(pair => { const index = pair.indexOf('='); return [pair.slice(0, index), pair.slice(index + 1)]; }));
    const raw = params.get('path') ?? params.get('abstract'); if (!raw) continue;
    let value: string; try { value = decodeURIComponent(raw); } catch { continue; }
    if (!value || value.length > 4096 || /[\x00-\x1f;,=]/.test(value)) continue;
    if (params.has('path') && !value.startsWith('/')) continue;
    // Node 24 原生支持 Linux abstract Unix sockets，显式 socket 分支不加载 usocket addon。
    return `unix:socket=${params.has('path') ? value : `\0${value}`}`;
  }
  throw new Error('desktop.bus-address');
}
export function createBus(address: string): MessageBus { return dbus.sessionBus({ busAddress: address, authMethods: ['EXTERNAL'] }); }
export async function call(bus: MessageBus, destination: string, path: string, iface: string, member: string, signature = '', body: unknown[] = []): Promise<unknown[]> {
  const reply = await bounded(bus.call(new dbus.Message({ destination, path, interface: iface, member, signature, body })));
  if (!reply || !Array.isArray(reply.body)) throw new Error('desktop.invalid-response');
  return reply.body as unknown[];
}
export async function owner(bus: MessageBus, name: string): Promise<string | undefined> {
  const result = await call(bus, 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'NameHasOwner', 's', [name]);
  if (result[0] !== true) return undefined;
  try {
    const current = await call(bus, 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'GetNameOwner', 's', [name]);
    return typeof current[0] === 'string' && /^:\d+\.\d+$/.test(current[0]) ? current[0] : undefined;
  } catch (error: unknown) {
    if (error instanceof dbus.DBusError && error.type === 'org.freedesktop.DBus.Error.NameHasNoOwner') return undefined;
    throw error;
  }
}
export function variant(value: unknown, signature: string): unknown {
  if (typeof value !== 'object' || value === null || Reflect.get(value, 'signature') !== signature) throw new Error('desktop.invalid-response');
  return Reflect.get(value, 'value') as unknown;
}
export function isSignal(message: Message, iface: string, member: string): boolean {
  return message.type === dbus.MessageType.SIGNAL && message.interface === iface && message.member === member;
}
