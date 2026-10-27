import dbus from 'dbus-next';
import type { MessageBus, Message } from 'dbus-next';
import { call, owner, isSignal } from './bus.ts';
import { desktopId } from './mpris.ts';
const destination = 'org.freedesktop.Notifications'; const path = '/org/freedesktop/Notifications';
function plain(value: string, max: number): string { return value.replace(/[\x00-\x1f]/g, ' ').slice(0, max); }
function markup(value: string): string { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!); }
export class LinuxNotifications {
  #bus: MessageBus; #show: () => void; #id = 0; #owner: string | undefined; #matchedOwner: string | undefined; #disposed = false; #tail: Promise<unknown> = Promise.resolve();
  constructor(bus: MessageBus, show: () => void) { this.#bus = bus; this.#show = show; this.#bus.on('message', this.#signal); }
  #signal = (message: Message): void => {
    if (this.#disposed || message.sender !== this.#owner || message.path !== path || message.body[0] !== this.#id || this.#id === 0) return;
    if (isSignal(message, destination, 'ActionInvoked') && message.body[1] === 'default') this.#show();
    if (isSignal(message, destination, 'NotificationClosed')) this.#id = 0;
  };
  send(title: string, body: string, current: () => boolean = () => true): Promise<boolean> {
    const pending = this.#tail.catch(() => undefined).then(async () => {
      if (this.#disposed || !current()) return false;
      const currentOwner = await owner(this.#bus, destination); if (!currentOwner) throw new Error('desktop.notification-unavailable');
      const caps = await call(this.#bus, destination, path, destination, 'GetCapabilities');
      if (!Array.isArray(caps[0]) || caps[0].some(value => typeof value !== 'string')) throw new Error('desktop.notification-capabilities');
      if (this.#owner !== currentOwner) { this.#id = 0; this.#owner = currentOwner; }
      if (this.#matchedOwner !== currentOwner) {
        if (this.#matchedOwner) await call(this.#bus, 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RemoveMatch', 's', [`type='signal',sender='${this.#matchedOwner}',interface='${destination}'`]).catch(() => undefined);
        await call(this.#bus, 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'AddMatch', 's', [`type='signal',sender='${currentOwner}',interface='${destination}'`]);
        this.#matchedOwner = currentOwner;
      }
      if (this.#disposed || !current()) return false;
      const content = plain(body, 320);
      const result = await call(this.#bus, destination, path, destination, 'Notify', 'susssasa{sv}i', ['StarsMusic', this.#id, 'audio-x-generic', plain(title, 160),
        caps[0].includes('body-markup') ? markup(content) : content, caps[0].includes('actions') ? ['default', '打开 StarsMusic'] : [],
        { 'desktop-entry': new dbus.Variant('s', desktopId), 'suppress-sound': new dbus.Variant('b', true), transient: new dbus.Variant('b', true) }, 4000]);
      const id = result[0]; if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || id > 0xffffffff) throw new Error('desktop.notification-response');
      if (this.#disposed || !current()) { void call(this.#bus, destination, path, destination, 'CloseNotification', 'u', [id]).catch(() => undefined); return false; }
      this.#id = id; return true;
    }); this.#tail = pending; return pending;
  }
  async dispose(): Promise<void> {
    if (this.#disposed) return; this.#disposed = true; this.#bus.removeListener('message', this.#signal);
    await this.#tail.catch(() => undefined);
    if (this.#id) await call(this.#bus, destination, path, destination, 'CloseNotification', 'u', [this.#id]).catch(() => undefined);
    if (this.#matchedOwner) await call(this.#bus, 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RemoveMatch', 's', [`type='signal',sender='${this.#matchedOwner}',interface='${destination}'`]).catch(() => undefined);
    this.#id = 0;
  }
}
