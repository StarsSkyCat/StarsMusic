import QRCode from 'qrcode';
import { DomainError, normalizeError } from '../../../contracts/src/errors.ts';
import { initialNeteaseSnapshot, neteaseId, parseNeteaseSnapshot, type NeteaseSnapshot, type NeteaseTrack } from '../../../contracts/src/netease.ts';
import { parseStreamResolution, type StreamResolution } from '../../../contracts/src/music.ts';
import { nonNegativeInteger, record, text } from '../../../contracts/src/validation.ts';
import { SessionGeneration, type SessionLease } from '../session-generation.ts';
import { DirectNeteaseTransport, type NeteaseTransport } from './transport.ts';

export function apiId(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return neteaseId(value);
}
function success(value: unknown): Record<string, unknown> {
  const body = record(value, 'netease.response');
  if (body.code === 301 || body.code === 302) throw new DomainError('session-expired');
  if (body.code === 403) throw new DomainError('permission-denied');
  if (body.code === 429) throw new DomainError('rate-limited');
  if (body.code !== 200) throw new DomainError('unavailable');
  return body;
}
export function parseTracks(value: unknown): NeteaseTrack[] {
  if (!Array.isArray(value)) throw new DomainError('invalid-response');
  return value.map((item: unknown) => {
    const raw = record(item, 'netease.song');
    if (!Array.isArray(raw.ar)) throw new DomainError('invalid-response');
    return {
      id: apiId(raw.id), name: text(raw.name, 'netease.name'),
      artists: raw.ar.map((artist: unknown) => text(record(artist, 'netease.artist').name, 'netease.artist.name')),
      durationMs: nonNegativeInteger(raw.dt, 'netease.duration'),
    };
  });
}
export function parseNeteaseStream(value: unknown, id: string, now: number): StreamResolution {
  const body = success(value);
  if (!Array.isArray(body.data) || body.data.length !== 1) throw new DomainError('invalid-response');
  const raw = record(body.data[0], 'netease.stream');
  if (apiId(raw.id) !== id) throw new DomainError('invalid-response');
  if (raw.code === 403) throw new DomainError('permission-denied');
  if (raw.code !== 200 || typeof raw.url !== 'string' || !raw.url) throw new DomainError('unavailable');
  if (/[\u0000-\u0020\u007f]/.test(raw.url)) throw new DomainError('invalid-response');
  const url = new URL(raw.url);
  // 历史接口常返回同域 HTTP 地址；只尝试同一 CDN 的 HTTPS，不向 HTTP 降级。
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.music.126.net') || url.username || url.password || url.port || url.hash) {
    throw new DomainError('invalid-response');
  }
  let access: StreamResolution['access'] = { kind: 'full' };
  if (raw.freeTrialInfo !== null && raw.freeTrialInfo !== undefined) {
    const trial = record(raw.freeTrialInfo, 'netease.preview');
    const start = nonNegativeInteger(trial.start, 'netease.preview.start');
    const end = nonNegativeInteger(trial.end, 'netease.preview.end');
    if (end <= start) throw new DomainError('invalid-response');
    // URL 可能已经是裁剪试听资源，只限制播放总长，不再按原曲偏移二次裁剪。
    access = { kind: 'preview', startMs: 0, durationMs: (end - start) * 1000 };
  }
  const level = raw.level === 'standard' ? 'standard' : raw.level === 'exhigh' || raw.level === 'higher' ? 'high'
    : raw.level === 'lossless' ? 'lossless' : raw.level === 'hires' ? 'hi-res' : 'unknown';
  return parseStreamResolution({
    track: { provider: 'netease', id }, source: {
      kind: 'remote', url: url.href, headers: {},
      ...(typeof raw.expi === 'number' && raw.expi > 0 && Number.isFinite(raw.expi) ? { expiresAt: Math.floor(now + raw.expi * 1000) } : {}),
    },
    quality: { level, ...(typeof raw.br === 'number' && raw.br > 0 ? { bitrateKbps: raw.br / 1000 } : {}),
      ...(['mp3', 'aac', 'flac', 'm4a', 'ogg'].includes(String(raw.type)) ? { codec: raw.type } : {}) }, access,
  });
}

interface ServiceOptions {
  transport?: () => NeteaseTransport;
  encodeQr?: (url: string) => Promise<string>;
  now?: () => number;
  autoPoll?: boolean;
}
type StatePatch = { [K in keyof NeteaseSnapshot]?: NeteaseSnapshot[K] | undefined };

export class NeteaseService {
  #state = initialNeteaseSnapshot();
  #sessions = new SessionGeneration();
  #lease: SessionLease | undefined;
  #transport: NeteaseTransport | undefined;
  #key = '';
  #deadline = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #listeners = new Set<(state: NeteaseSnapshot) => void>();
  #options: ServiceOptions;
  #view = 0;
  #playlistOffset = 0;
  #knownPlaylists = new Set<string>();
  #knownTracks = new Map<string, NeteaseTrack>();
  #listBusy = false;
  #pollingLease: SessionLease | undefined;

  constructor(options: ServiceOptions = {}) { this.#options = options; }
  #now(): number { return this.#options.now?.() ?? Date.now(); }
  snapshot(): NeteaseSnapshot { return this.#state; }
  subscribe(listener: (state: NeteaseSnapshot) => void): () => void {
    this.#listeners.add(listener); return () => { this.#listeners.delete(listener); };
  }
  #update(patch: StatePatch): void {
    this.#state = parseNeteaseSnapshot({ ...this.#state, ...patch, revision: this.#state.revision + 1 });
    for (const listener of this.#listeners) listener(this.#state);
  }
  #clear(): void {
    clearTimeout(this.#timer); this.#timer = undefined;
    this.#transport?.clear(); this.#transport = undefined; this.#key = '';
    this.#knownTracks.clear(); this.#knownPlaylists.clear(); this.#playlistOffset = 0; this.#listBusy = false; this.#view++;
  }
  #end(status: 'signed-out' | 'cancelled' | 'expired' | 'failed', error?: NeteaseSnapshot['error']): NeteaseSnapshot {
    this.#sessions.invalidate('netease'); this.#lease = undefined; this.#clear();
    this.#update({ ...initialNeteaseSnapshot(), generation: this.#state.generation + 1, status, error });
    return this.#state;
  }
  cancelLogin(): NeteaseSnapshot {
    if (this.#state.status === 'connected') return this.#state;
    return this.#end('cancelled');
  }
  logout(): NeteaseSnapshot { return this.#end('signed-out'); }
  dispose(): void { this.logout(); this.#listeners.clear(); }

  async startLogin(): Promise<NeteaseSnapshot> {
    this.#clear();
    const lease = this.#sessions.activate({ provider: 'netease', clientChannel: 'netease-app' });
    this.#lease = lease;
    const transport = this.#options.transport?.() ?? new DirectNeteaseTransport();
    this.#transport = transport;
    this.#deadline = this.#now() + 180000;
    this.#update({ ...initialNeteaseSnapshot(), generation: lease.generation, status: 'loading-qr', busy: true });
    try {
      const body = success(await transport.call('qrKey', { type: 3 }, lease.signal));
      const key = text(body.unikey, 'netease.qrKey');
      if (!/^[A-Za-z0-9_-]{1,512}$/.test(key)) throw new DomainError('invalid-response');
      const url = `https://music.163.com/login?codekey=${encodeURIComponent(key)}`;
      const image = await (this.#options.encodeQr?.(url) ?? QRCode.toDataURL(url, { width: 240, margin: 2 }));
      this.#sessions.commit(lease, () => {
        this.#key = key;
        this.#update({ status: 'waiting-scan', qrImage: image, expiresAt: this.#deadline, busy: false });
        this.#schedule(lease, 2000);
      });
    } catch (error: unknown) {
      if (this.#sessions.isCurrent(lease)) this.#end('failed', normalizeError(error));
    }
    return this.#state;
  }
  #schedule(lease: SessionLease, delay: number): void {
    if (this.#options.autoPoll === false || !this.#sessions.isCurrent(lease)) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { void this.pollOnce(); }, delay);
  }
  async pollOnce(): Promise<NeteaseSnapshot> {
    const lease = this.#lease; const transport = this.#transport;
    if (!lease || !transport || !this.#key || this.#pollingLease === lease || this.#state.status === 'connected') return this.#state;
    if (this.#now() >= this.#deadline) return this.#end('expired');
    this.#pollingLease = lease;
    let next = 2000;
    try {
      const result = record(await transport.call('qrPoll', { key: this.#key, type: 3 }, lease.signal), 'netease.poll');
      if (!this.#sessions.isCurrent(lease)) return this.#state;
      if (result.code === 800) return this.#end('expired');
      if (result.code === 801 || result.code === 802) {
        this.#update({ status: result.code === 801 ? 'waiting-scan' : 'awaiting-confirmation', error: undefined });
      } else if (result.code === 803) {
        if (!transport.hasIdentity()) throw new DomainError('unauthenticated');
        this.#update({ status: 'verifying' });
        const body = success(await transport.call('account', {}, lease.signal));
        const account = record(body.account, 'netease.account');
        const profile = record(body.profile, 'netease.profile');
        const id = apiId(account.id);
        if (id !== apiId(profile.userId)) throw new DomainError('invalid-response');
        if (!this.#sessions.isCurrent(lease)) return this.#state;
        const nickname = text(profile.nickname, 'netease.nickname');
        const connected = this.#sessions.activate({ provider: 'netease', clientChannel: 'netease-app', accountId: id });
        this.#lease = connected; this.#key = ''; clearTimeout(this.#timer);
        this.#update({ status: 'connected', generation: connected.generation, account: { id, nickname }, error: undefined });
      } else throw new DomainError('invalid-response');
    } catch (error: unknown) {
      if (this.#sessions.isCurrent(lease)) {
        const safe = normalizeError(error);
        if (['network', 'timeout', 'rate-limited'].includes(safe.code)) { this.#update({ error: safe }); next = 10000; }
        else return this.#end('failed', safe);
      }
    } finally {
      if (this.#pollingLease === lease) this.#pollingLease = undefined;
      if (this.#key) this.#schedule(lease, next);
    }
    return this.#state;
  }

  #connected(): { lease: SessionLease; transport: NeteaseTransport } {
    if (this.#state.status !== 'connected' || !this.#lease || !this.#transport) throw new DomainError('unauthenticated');
    return { lease: this.#lease, transport: this.#transport };
  }
  #operationError(lease: SessionLease, error: unknown): void {
    if (!this.#sessions.isCurrent(lease)) return;
    const safe = normalizeError(error);
    if (safe.code === 'session-expired') this.#end('expired', safe);
    else this.#update({ busy: false, error: safe });
  }
  async loadPlaylists(): Promise<NeteaseSnapshot> {
    const { lease, transport } = this.#connected();
    if (this.#listBusy || (this.#playlistOffset > 0 && !this.#state.playlistsMore)) return this.#state;
    this.#listBusy = true; this.#update({ busy: true, error: undefined });
    try {
      const body = success(await transport.call('playlists', { uid: lease.context.accountId, limit: 50, offset: this.#playlistOffset, includeVideo: false }, lease.signal));
      if (!Array.isArray(body.playlist) || typeof body.more !== 'boolean') throw new DomainError('invalid-response');
      const items = body.playlist.map((value: unknown) => {
        const item = record(value, 'netease.playlist');
        return { id: apiId(item.id), name: text(item.name, 'netease.playlist.name'), trackCount: nonNegativeInteger(item.trackCount, 'netease.trackCount') };
      });
      this.#sessions.commit(lease, () => {
        this.#playlistOffset += items.length;
        for (const item of items) this.#knownPlaylists.add(item.id);
        const merged = new Map([...this.#state.playlists, ...items].map((item) => [item.id, item]));
        this.#update({ playlists: [...merged.values()], playlistsMore: body.more as boolean, busy: false });
      });
    } catch (error: unknown) { this.#operationError(lease, error); }
    finally { if (this.#sessions.isCurrent(lease)) this.#listBusy = false; }
    return this.#state;
  }
  async loadPlaylist(id: string, offset: number): Promise<NeteaseSnapshot> {
    neteaseId(id); nonNegativeInteger(offset, 'netease.offset');
    const { lease, transport } = this.#connected();
    if (!this.#knownPlaylists.has(id) || (offset !== 0 && (this.#state.playlistId !== id || offset !== this.#state.nextTrackOffset))) throw new DomainError('invalid-input');
    const view = ++this.#view;
    this.#update({ playlistId: id, ...(offset === 0 ? { tracks: [], tracksMore: false, nextTrackOffset: 0 } : {}), busy: true, error: undefined });
    try {
      const body = success(await transport.call('playlist', { id, n: 1000, s: 0 }, lease.signal));
      const playlist = record(body.playlist, 'netease.playlist');
      if (apiId(playlist.id) !== id || !Array.isArray(playlist.trackIds)) throw new DomainError('invalid-response');
      const ids = playlist.trackIds.slice(offset, offset + 50).map((value: unknown) => apiId(record(value, 'netease.trackId').id));
      const detail = ids.length ? success(await transport.call('songs', { c: JSON.stringify(ids.map((id) => ({ id }))) }, lease.signal)) : { songs: [] };
      const found = new Map(parseTracks(detail.songs).map((track) => [track.id, track]));
      const tracks = ids.flatMap((id) => found.has(id) ? [found.get(id)!] : []);
      if (view !== this.#view) return this.#state;
      this.#sessions.commit(lease, () => {
        for (const track of tracks) this.#knownTracks.set(track.id, track);
        this.#update({ tracks: offset === 0 ? tracks : [...this.#state.tracks, ...tracks], nextTrackOffset: offset + ids.length,
          tracksMore: offset + ids.length < (playlist.trackIds as unknown[]).length, busy: false });
      });
    } catch (error: unknown) { if (view === this.#view) this.#operationError(lease, error); }
    return this.#state;
  }
  async resolveTrack(id: string, generation: number): Promise<StreamResolution> {
    const { lease, transport } = this.#connected();
    if (generation !== this.#state.generation || !this.#knownTracks.has(neteaseId(id))) throw new DomainError('stale-operation');
    try {
      const value = await transport.call('stream', { ids: JSON.stringify([id]), br: 128000 }, lease.signal);
      if (!this.#sessions.isCurrent(lease)) throw new DomainError('stale-operation');
      return parseNeteaseStream(value, id, this.#now());
    } catch (error: unknown) { this.#operationError(lease, error); throw error; }
  }
}
