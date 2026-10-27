import dbus from 'dbus-next';
import type { MessageBus } from 'dbus-next';
import type { PlaybackPort, WindowPort } from '../platform.ts';
import { adjacent, togglePlayback } from '../platform.ts';
import { adjacentIndex, type PlaybackSnapshot } from '../../../contracts/src/playback.ts';

const { Interface } = dbus.interface;
export const mprisPath = '/org/mpris/MediaPlayer2';
export const mprisPlayer = 'org.mpris.MediaPlayer2.Player';
export const desktopId = 'org.starsmusic.StarsMusic';
export function trackPath(state: PlaybackSnapshot): string {
  const id = state.queue[state.currentIndex ?? -1]?.id;
  return id ? `/org/starsmusic/track/t${Buffer.from(id).toString('hex')}` : '/org/mpris/MediaPlayer2/TrackList/NoTrack';
}
function microseconds(value: number): bigint { return BigInt(Math.round(value * 1000000)); }
function seconds(value: unknown): number | undefined {
  if (typeof value !== 'bigint' && typeof value !== 'number') return undefined;
  const number = Number(value); return Number.isSafeInteger(number) ? number / 1000000 : undefined;
}
class RootInterface extends Interface {
  #window: WindowPort;
  constructor(window: WindowPort) { super('org.mpris.MediaPlayer2'); this.#window = window; }
  Raise(): void { this.#window.show(); }
  Quit(): void { this.#window.quit(); }
  get CanQuit() { return true; } get CanRaise() { return true; } get HasTrackList() { return false; }
  get Identity() { return 'StarsMusic'; } get DesktopEntry() { return desktopId; }
  get SupportedUriSchemes() { return []; } get SupportedMimeTypes() { return []; }
}
RootInterface.configureMembers({
  methods: { Raise: {}, Quit: {} }, properties: Object.fromEntries([
    ['CanQuit', 'b'], ['CanRaise', 'b'], ['HasTrackList', 'b'], ['Identity', 's'], ['DesktopEntry', 's'], ['SupportedUriSchemes', 'as'], ['SupportedMimeTypes', 'as'],
  ].map(([key, signature]) => [key!, { signature: signature!, access: 'read' as const }])),
});
class PlayerInterface extends Interface {
  #player: PlaybackPort; #artUrl: string | undefined;
  constructor(player: PlaybackPort) { super(mprisPlayer); this.#player = player; }
  get state() { return this.#player.snapshot(); }
  async Next(): Promise<void> { await adjacent(this.#player, 1); }
  async Previous(): Promise<void> { await adjacent(this.#player, -1); }
  async Pause(): Promise<void> { if (this.CanPause) await this.#player.pause(); }
  async PlayPause(): Promise<void> { await togglePlayback(this.#player); }
  async Stop(): Promise<void> { await this.#player.stop(); }
  async Play(): Promise<void> { if (this.state.status !== 'playing' && this.state.status !== 'loading') await togglePlayback(this.#player); }
  async Seek(offset: unknown): Promise<void> {
    const value = seconds(offset); if (value === undefined || !this.CanSeek) return;
    const target = this.state.positionSeconds + value;
    if (target > this.state.durationSeconds && this.CanGoNext) await this.Next();
    else await this.#player.seek(Math.max(0, Math.min(target, this.state.durationSeconds)));
  }
  async SetPosition(id: string, position: unknown): Promise<void> {
    const value = seconds(position);
    if (id !== trackPath(this.state) || value === undefined || !this.CanSeek || value < 0 || value > this.state.durationSeconds) return;
    await this.#player.seek(value);
  }
  OpenUri(): never { throw new dbus.DBusError('org.mpris.MediaPlayer2.Error.NotSupported', 'OpenUri is not supported'); }
  get PlaybackStatus() { return this.state.status === 'playing' ? 'Playing' : ['paused', 'loading'].includes(this.state.status) ? 'Paused' : 'Stopped'; }
  get LoopStatus() { return { none: 'None', playlist: 'Playlist', track: 'Track' }[this.state.loopMode]; }
  set LoopStatus(value: string) {
    if (value !== 'None' && value !== 'Playlist' && value !== 'Track') throw new dbus.DBusError('org.freedesktop.DBus.Error.InvalidArgs', 'Invalid loop status');
    this.#player.setLoopMode(value === 'Track' ? 'track' : value === 'Playlist' ? 'playlist' : 'none');
  }
  get Shuffle() { return this.state.shuffle; }
  set Shuffle(value: boolean) {
    if (typeof value !== 'boolean') throw new dbus.DBusError('org.freedesktop.DBus.Error.InvalidArgs', 'Invalid shuffle');
    this.#player.setShuffle(value);
  }
  get Rate() { return 1; }
  set Rate(value: number) { if (value !== 1) throw new dbus.DBusError('org.freedesktop.DBus.Error.NotSupported', 'Only rate 1 is supported'); }
  get MinimumRate() { return 1; } get MaximumRate() { return 1; }
  get Volume() { return this.state.muted ? 0 : this.state.volume / 100; }
  set Volume(value: number) {
    if (!Number.isFinite(value)) throw new dbus.DBusError('org.freedesktop.DBus.Error.InvalidArgs', 'Invalid volume');
    void this.#player.setVolume(Math.max(0, Math.min(1, value)) * 100).catch(() => undefined);
  }
  get Position() { return microseconds(this.state.positionSeconds); }
  get Metadata(): Record<string, dbus.Variant> {
    const track = this.state.queue[this.state.currentIndex ?? -1];
    if (!track) return {};
    return { 'mpris:trackid': new dbus.Variant('o', trackPath(this.state)), 'xesam:title': new dbus.Variant('s', track.title),
      ...(track.artist ? { 'xesam:artist': new dbus.Variant('as', [track.artist]) } : {}),
      ...(this.state.durationSeconds ? { 'mpris:length': new dbus.Variant('x', microseconds(this.state.durationSeconds)) } : {}),
      ...(this.#artUrl ? { 'mpris:artUrl': new dbus.Variant('s', this.#artUrl) } : {}),
    };
  }
  get CanGoNext() { return adjacentIndex(this.state, 1) !== null; }
  get CanGoPrevious() { return adjacentIndex(this.state, -1) !== null; }
  get CanPlay() { return this.state.queue.length > 0; }
  get CanPause() { return ['paused', 'playing'].includes(this.state.status); }
  get CanSeek() { return this.CanPause && this.state.durationSeconds > 0; }
  get CanControl() { return true; }
  Seeked(position: bigint): bigint { return position; }
  setArt(url: string | undefined): void { this.#artUrl = url; this.publish(); }
  publish(): void {
    try { Interface.emitPropertiesChanged(this, { PlaybackStatus: this.PlaybackStatus, LoopStatus: this.LoopStatus, Shuffle: this.Shuffle, Metadata: this.Metadata, Volume: this.Volume,
      CanGoNext: this.CanGoNext, CanGoPrevious: this.CanGoPrevious, CanPlay: this.CanPlay, CanPause: this.CanPause, CanSeek: this.CanSeek }, []); } catch { /* 桌面总线故障不传播到音频状态源。 */ }
  }
}
PlayerInterface.configureMembers({ methods: { Next: {}, Previous: {}, Pause: {}, PlayPause: {}, Stop: {}, Play: {}, Seek: { inSignature: 'x' }, SetPosition: { inSignature: 'ox' }, OpenUri: { inSignature: 's' } },
  signals: { Seeked: { signature: 'x' } }, properties: {
    ...Object.fromEntries([['PlaybackStatus', 's'], ['Metadata', 'a{sv}'], ['Position', 'x'], ['MinimumRate', 'd'], ['MaximumRate', 'd'],
      ['CanGoNext', 'b'], ['CanGoPrevious', 'b'], ['CanPlay', 'b'], ['CanPause', 'b'], ['CanSeek', 'b'], ['CanControl', 'b']].map(([key, signature]) => [key!, { signature: signature!, access: 'read' as const }])),
    Rate: { signature: 'd', access: 'readwrite' }, Volume: { signature: 'd', access: 'readwrite' },
    LoopStatus: { signature: 's', access: 'readwrite' }, Shuffle: { signature: 'b', access: 'readwrite' },
  } });

export class MprisService {
  readonly name = `org.mpris.MediaPlayer2.StarsMusic.instance${process.pid}`;
  #disposed = false; #exported = false;
  #bus: MessageBus; #root: RootInterface; #interface: PlayerInterface; #unsubscribe: (() => void)[] = [];
  constructor(bus: MessageBus, player: PlaybackPort, window: WindowPort) {
    this.#bus = bus; this.#root = new RootInterface(window); this.#interface = new PlayerInterface(player);
  }
  async initialize(player: PlaybackPort): Promise<void> {
    const result = await this.#bus.requestName(this.name, dbus.NameFlag.DO_NOT_QUEUE);
    if (result !== dbus.RequestNameReply.PRIMARY_OWNER && result !== dbus.RequestNameReply.ALREADY_OWNER) throw new Error('desktop.mpris-name');
    if (this.#disposed) return;
    this.#bus.export(mprisPath, this.#root); this.#bus.export(mprisPath, this.#interface); this.#exported = true;
    let previous = player.snapshot();
    this.#unsubscribe.push(player.subscribe(state => {
      const old = previous; previous = state;
      if (old.generation !== state.generation) this.#interface.setArt(undefined);
      if (old.positionSeconds === state.positionSeconds || old.generation !== state.generation || old.durationSeconds !== state.durationSeconds || old.status !== state.status) this.#interface.publish();
    }), player.subscribeSeeked(position => { try { this.#interface.Seeked(microseconds(position)); } catch { /* 总线已断开。 */ } }));
  }
  setArt(url: string | undefined): void { if (!this.#disposed) this.#interface.setArt(url); }
  dispose(): void {
    if (this.#disposed) return; this.#disposed = true;
    for (const unsubscribe of this.#unsubscribe) unsubscribe(); this.#unsubscribe = [];
    // unexport(path) 是公开 API；0.10.2 类型遗漏了可省略的第二参数。
    if (this.#exported) Reflect.apply(this.#bus.unexport, this.#bus, [mprisPath]);
    this.#exported = false;
  }
}
