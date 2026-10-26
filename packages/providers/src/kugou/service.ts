import QRCode from 'qrcode';
import { DomainError, normalizeError } from '../../../contracts/src/errors.ts';
import { initialKugouSnapshot, kugouId, parseKugouSnapshot, type KugouSnapshot, type KugouTrack, type KugouLoginDiagnostic } from '../../../contracts/src/kugou.ts';
import { parseStreamResolution, type StreamResolution } from '../../../contracts/src/music.ts';
import { allowedKugouMediaHost } from '../../../contracts/src/media-policy.ts';
import { nonNegativeInteger, record, text } from '../../../contracts/src/validation.ts';
import { SessionGeneration, type SessionLease } from '../session-generation.ts';
import { DirectKugouTransport, type KugouTransport } from './transport.ts';

export function apiId(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return kugouId(value);
}
function success(value: unknown): Record<string, unknown> {
  const body = record(value, 'kugou.response');
  if (body.status !== 1 || (body.error_code !== undefined && body.error_code !== 0)) throw new DomainError('unavailable');
  return body;
}
interface BackendTrack { track: KugouTrack; hash: string; albumId: string; audioId: string }
const trackPageSize = 300;
function numericId(value: unknown): string {
  const id = apiId(value); if (!/^\d{1,30}$/.test(id)) throw new DomainError('invalid-response'); return id;
}
// 平台不同端点可能把数量/时长作为数字或十进制字符串返回；只接受非负安全整数。
function integerValue(value: unknown, field: string): number {
  if (typeof value === 'number') return nonNegativeInteger(value, field);
  if (typeof value === 'string' && /^\d{1,15}$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new DomainError('invalid-response');
}
function optionalInteger(value: unknown, field: string): number | undefined {
  return value === undefined || value === null || value === '' ? undefined : integerValue(value, field);
}
function parseTracks(value: unknown): { items: BackendTrack[]; received: number } {
  if (!Array.isArray(value) || value.length > 500) throw new DomainError('invalid-response');
  const items: BackendTrack[] = [];
  for (const entry of value) {
    // 单条损坏不应让整页不可用；仍要求至少有一条可播放曲目。
    try {
      const raw = record(entry, 'kugou.song');
      const hash = text(raw.hash ?? raw.filehash, 'kugou.hash').toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(hash)) continue;
      const singers = Array.isArray(raw.singerinfo) ? raw.singerinfo
        : Array.isArray(raw.authors) ? raw.authors : [];
      const artists = singers.flatMap((value: unknown) => {
        try {
          const singer = record(value, 'kugou.singer');
          return [text(singer.name ?? singer.author_name, 'kugou.singer.name')];
        } catch { return []; }
      });
      const name = text(raw.name ?? raw.filename ?? raw.songname, 'kugou.song.name');
      const timelen = optionalInteger(raw.timelen, 'kugou.timelen');
      const seconds = optionalInteger(raw.duration, 'kugou.duration');
      const durationMs = timelen ?? (seconds === undefined ? 0 : seconds * 1000);
      const album = raw.albuminfo === undefined ? {} : record(raw.albuminfo, 'kugou.album');
      items.push({
        track: { id: hash, name, artists, durationMs }, hash,
        albumId: numericId(raw.album_id ?? album.id ?? 0),
        audioId: numericId(raw.album_audio_id ?? raw.audio_id ?? raw.mixsongid ?? 0),
      });
    } catch { /* 跳过无法安全解析的单条记录 */ }
  }
  if (value.length > 0 && items.length === 0) throw new DomainError('invalid-response');
  return { items, received: value.length };
}
export function parseKugouStream(value: unknown, id: string): StreamResolution {
  const raw = success(value);
  if (!Array.isArray(raw.url) || typeof raw.url[0] !== 'string' || !raw.url[0]) throw new DomainError('permission-denied');
  if (/[\u0000-\u0020\u007f]/.test(raw.url[0])) throw new DomainError('invalid-response');
  const url = new URL(raw.url[0]); if (url.protocol === 'http:') url.protocol = 'https:';
  if (!allowedKugouMediaHost(url.hostname) || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) throw new DomainError('invalid-response');
  let access: StreamResolution['access'] = { kind: 'full' };
  // 付费片段必须由平台明确给出边界；不能从“已登录”或 URL 非空推断完整权限。
  if (raw.priv_status !== 0) {
    const start = nonNegativeInteger(raw.free_part_start, 'kugou.preview.start');
    const end = nonNegativeInteger(raw.free_part_end, 'kugou.preview.end');
    if (end <= start) throw new DomainError('permission-denied');
    access = { kind: 'preview', startMs: 0, durationMs: end - start };
  }
  const bitrate = typeof raw.bitRate === 'number' && raw.bitRate > 0 ? raw.bitRate / 1000 : undefined;
  return parseStreamResolution({ track: { provider: 'kugou', id }, source: { kind: 'remote', url: url.href, headers: {} },
    quality: { level: raw.extName === 'flac' ? 'lossless' : bitrate === undefined ? 'unknown' : bitrate > 128 ? 'high' : 'standard',
      ...(bitrate ? { bitrateKbps: bitrate } : {}), ...(['mp3', 'flac', 'm4a', 'ogg', 'aac'].includes(String(raw.extName)) ? { codec: raw.extName } : {}) }, access });
}

interface ServiceOptions {
  transport?: () => KugouTransport;
  encodeQr?: (url: string) => Promise<string>;
  now?: () => number;
  autoPoll?: boolean;
}
type StatePatch = { [K in keyof KugouSnapshot]?: KugouSnapshot[K] | undefined };

export class KugouService {
  #state = initialKugouSnapshot();
  #sessions = new SessionGeneration();
  #lease: SessionLease | undefined;
  #transport: KugouTransport | undefined;
  #key = '';
  #diagnostic: KugouLoginDiagnostic | undefined;
  #deadline = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #listeners = new Set<(state: KugouSnapshot) => void>();
  #options: ServiceOptions;
  #view = 0;
  #playlistOffset = 0;
  #knownPlaylists = new Map<string, number>();
  #knownTracks = new Map<string, BackendTrack>();
  #listBusy = false;
  #pollingLease: SessionLease | undefined;

  constructor(options: ServiceOptions = {}) { this.#options = options; }
  #now(): number { return this.#options.now?.() ?? Date.now(); }
  snapshot(): KugouSnapshot { return this.#state; }
  subscribe(listener: (state: KugouSnapshot) => void): () => void {
    this.#listeners.add(listener); return () => { this.#listeners.delete(listener); };
  }
  #update(patch: StatePatch): void {
    this.#state = parseKugouSnapshot({ ...this.#state, ...patch, revision: this.#state.revision + 1 });
    for (const listener of this.#listeners) listener(this.#state);
  }
  #clear(): void {
    clearTimeout(this.#timer); this.#timer = undefined;
    this.#transport?.clear(); this.#transport = undefined; this.#key = '';
    this.#knownTracks.clear(); this.#knownPlaylists.clear(); this.#playlistOffset = 0; this.#listBusy = false; this.#view++;
  }
  #end(status: 'signed-out' | 'cancelled' | 'expired' | 'failed', error?: KugouSnapshot['error']): KugouSnapshot {
    this.#sessions.invalidate('kugou'); this.#lease = undefined; this.#clear();
    this.#update({ ...initialKugouSnapshot(), generation: this.#state.generation + 1, status, error, ...(status === 'failed' ? { loginDiagnostic: this.#diagnostic } : {}) });
    return this.#state;
  }
  cancelLogin(): KugouSnapshot {
    if (this.#state.status === 'connected') return this.#state;
    return this.#end('cancelled');
  }
  logout(): KugouSnapshot { return this.#end('signed-out'); }
  dispose(): void { this.logout(); this.#listeners.clear(); }

  async startLogin(): Promise<KugouSnapshot> {
    this.#clear(); this.#diagnostic = undefined;
    const lease = this.#sessions.activate({ provider: 'kugou', clientChannel: 'kugou-app' });
    this.#lease = lease;
    const transport = this.#options.transport?.() ?? new DirectKugouTransport();
    this.#transport = transport;
    this.#deadline = this.#now() + 180000;
    this.#update({ ...initialKugouSnapshot(), generation: lease.generation, status: 'loading-qr', busy: true });
    try {
      success(await transport.call('register', {}, lease.signal));
      const body = success(await transport.call('qrKey', {}, lease.signal));
      const key = text(record(body.data, 'kugou.qr').qrcode, 'kugou.qrKey');
      if (!/^[A-Za-z0-9_-]{1,512}$/.test(key)) throw new DomainError('invalid-response');
      const url = `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${encodeURIComponent(key)}`;
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
  async pollOnce(): Promise<KugouSnapshot> {
    const lease = this.#lease; const transport = this.#transport;
    if (!lease || !transport || !this.#key || this.#pollingLease === lease || this.#state.status === 'connected') return this.#state;
    if (this.#now() >= this.#deadline) return this.#end('expired');
    this.#pollingLease = lease;
    let next = 2000;
    try {
      const result = record(success(await transport.call('qrPoll', { key: this.#key }, lease.signal)).data, 'kugou.poll');
      if (!this.#sessions.isCurrent(lease)) return this.#state;
      if (result.status === 0) return this.#end('expired');
      if (result.status === 1 || result.status === 2) {
        this.#update({ status: result.status === 1 ? 'waiting-scan' : 'awaiting-confirmation', error: undefined });
      } else if (result.status === 4) {
        this.#diagnostic = 'authorization-userid';
        const id = numericId(result.userid);
        this.#diagnostic = 'authorization-token';
        transport.acceptIdentity(id, text(result.token, 'kugou.token'));
        this.#update({ status: 'verifying' });
        this.#diagnostic = 'account-request';
        const profile = record(success(await transport.call('account', {}, lease.signal)).data, 'kugou.profile');
        // get_my_info 验证 token + userid + RSA proof 后返回私有账号资料，部分响应不回显 ID。
        // 不能要求不存在的回显字段；若确实回显，则必须严格匹配，不能覆盖扫码身份。
        const echoedId = profile.userid ?? profile.user_id ?? profile.uid;
        if (echoedId !== undefined) {
          this.#diagnostic = 'profile-userid';
          const profileId = numericId(echoedId);
          this.#diagnostic = 'profile-mismatch';
          if (profileId !== id) throw new DomainError('invalid-response');
        }
        this.#diagnostic = 'profile-nickname';
        const nickname = text(profile.nickname ?? profile.username ?? profile.user_name, 'kugou.nickname');
        if (!this.#sessions.isCurrent(lease)) return this.#state;
        const connected = this.#sessions.activate({ provider: 'kugou', clientChannel: 'kugou-app', accountId: id });
        this.#diagnostic = undefined;
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

  #connected(): { lease: SessionLease; transport: KugouTransport } {
    if (this.#state.status !== 'connected' || !this.#lease || !this.#transport) throw new DomainError('unauthenticated');
    return { lease: this.#lease, transport: this.#transport };
  }
  #operationError(lease: SessionLease, error: unknown): void {
    if (!this.#sessions.isCurrent(lease)) return;
    const safe = normalizeError(error);
    if (safe.code === 'session-expired') this.#end('expired', safe);
    else this.#update({ busy: false, error: safe });
  }
  async loadPlaylists(): Promise<KugouSnapshot> {
    const { lease, transport } = this.#connected();
    if (this.#listBusy || (this.#playlistOffset > 0 && !this.#state.playlistsMore)) return this.#state;
    this.#listBusy = true; this.#update({ busy: true, error: undefined });
    try {
      const data = record(success(await transport.call('playlists', { page: this.#playlistOffset / 50 + 1 }, lease.signal)).data, 'kugou.playlists');
      const info = data.info;
      let rows: unknown[];
      if (Array.isArray(info)) rows = info;
      else {
        const groups = record(info ?? data, 'kugou.playlist.groups');
        const names = ['collect', 'love', 'self', 'list'];
        if (!names.some((key) => Array.isArray(groups[key]))) throw new DomainError('invalid-response');
        rows = names.flatMap((key) => Array.isArray(groups[key]) ? groups[key] as unknown[] : []);
      }
      const entries = rows.map((value: unknown) => {
        const item = record(value, 'kugou.playlist');
        const id = numericId(item.list_create_listid ?? item.listid);
        return { id, name: text(item.name ?? item.listname, 'kugou.playlist.name'), trackCount: nonNegativeInteger(item.count ?? item.song_count ?? 0, 'kugou.count'), type: nonNegativeInteger(item.type ?? 0, 'kugou.type') };
      });
      this.#sessions.commit(lease, () => {
        this.#playlistOffset += 50;
        for (const item of entries) this.#knownPlaylists.set(item.id, item.type);
        const items = entries.map(({ id, name, trackCount }) => ({ id, name, trackCount }));
        const merged = new Map([...this.#state.playlists, ...items].map((item) => [item.id, item]));
        this.#update({ playlists: [...merged.values()], playlistsMore: rows.length >= 50, busy: false });
      });
    } catch (error: unknown) { this.#operationError(lease, error); }
    finally { if (this.#sessions.isCurrent(lease)) this.#listBusy = false; }
    return this.#state;
  }
  async loadPlaylist(id: string, offset: number): Promise<KugouSnapshot> {
    kugouId(id); nonNegativeInteger(offset, 'kugou.offset');
    const { lease, transport } = this.#connected();
    if (offset % trackPageSize !== 0 || !this.#knownPlaylists.has(id) || (offset !== 0 && (this.#state.playlistId !== id || offset !== this.#state.nextTrackOffset))) throw new DomainError('invalid-input');
    const view = ++this.#view;
    this.#update({ playlistId: id, ...(offset === 0 ? { tracks: [], tracksMore: false, nextTrackOffset: 0 } : {}), busy: true, error: undefined });
    try {
      const data = record(success(await transport.call('playlist', { id, type: this.#knownPlaylists.get(id), page: offset / trackPageSize + 1 }, lease.signal)).data, 'kugou.playlist');
      const rows = data.info ?? data.songs ?? data.lists ?? data.file;
      // 末页可能没有 info 字段；首屏缺少列表仍按无效响应处理。
      if (rows === undefined && offset === 0) throw new DomainError('invalid-response');
      const parsed = parseTracks(rows === undefined ? [] : Array.isArray(rows) ? rows : record(rows, 'kugou.files').file);
      const total = optionalInteger(data.count ?? data.total, 'kugou.total');
      if (view !== this.#view) return this.#state;
      this.#sessions.commit(lease, () => {
        for (const item of parsed.items) this.#knownTracks.set(item.track.id, item);
        const tracks = parsed.items.map((item) => item.track);
        const merged = new Map([...(offset === 0 ? [] : this.#state.tracks), ...tracks].map((track) => [track.id, track]));
        // 部分云歌单响应不返回总数；此时只有满页才继续请求，避免把末页误判为还有数据。
        const more = parsed.received >= trackPageSize && (total === undefined || offset + parsed.received < total);
        this.#update({ tracks: [...merged.values()], nextTrackOffset: offset + trackPageSize, tracksMore: more, busy: false });
      });
    } catch (error: unknown) { if (view === this.#view) this.#operationError(lease, error); }
    return this.#state;
  }
  async resolveTrack(id: string, generation: number): Promise<StreamResolution> {
    const { lease, transport } = this.#connected();
    if (generation !== this.#state.generation || !this.#knownTracks.has(kugouId(id))) throw new DomainError('stale-operation');
    try {
      const item = this.#knownTracks.get(id)!;
      const value = await transport.call('stream', { hash: item.hash, albumId: item.albumId, audioId: item.audioId }, lease.signal);
      if (!this.#sessions.isCurrent(lease)) throw new DomainError('stale-operation');
      return parseKugouStream(value, id);
    } catch (error: unknown) { this.#operationError(lease, error); throw error; }
  }
}
