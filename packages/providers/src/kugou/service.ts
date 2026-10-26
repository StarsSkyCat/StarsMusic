import { getKugouLyrics, type LyricRequest } from './lyrics.ts';
import { parsePresentationContent, type PresentationContent } from '../../../contracts/src/presentation.ts';
import { loadArtwork, type LoadArtwork } from '../artwork.ts';
import QRCode from 'qrcode';
import { DomainError, normalizeError } from '../../../contracts/src/errors.ts';
import { parseCredentialBundle, type KugouCredentialBundle } from '../../../contracts/src/credentials.ts';
import { initialKugouSnapshot, kugouId, kugouTrackPageSize, parseKugouSnapshot, type KugouSnapshot, type KugouTrack, type KugouLoginDiagnostic } from '../../../contracts/src/kugou.ts';
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
interface BackendTrack { track: KugouTrack; hash: string; cover?: string; album?: string }
const trackPageSize = kugouTrackPageSize;
let loggedTrackRow = false;
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
      const name = text(raw.name ?? raw.filename ?? raw.songname, 'kugou.song.name').replace(/\.(?:mp3|flac|m4a|aac|ogg|wav|ape|opus|aiff?)$/i, '').trim();
      if (!name) continue;
      const timelen = optionalInteger(raw.timelen, 'kugou.timelen');
      const seconds = optionalInteger(raw.duration, 'kugou.duration');
      const durationMs = timelen ?? (seconds === undefined ? 0 : seconds * 1000);
      if (!loggedTrackRow) {
        loggedTrackRow = true;
        const nameSource = raw.name !== undefined ? 'name' : raw.filename !== undefined ? 'filename' : 'songname';
        debugKugou(`track row keys=${Object.keys(raw).sort().join(',')} nameSource=${nameSource} hash=${hash.slice(0, 6)} fileid=${raw.fileid === undefined ? 'none' : 'set'} duration=${durationMs}`);
      }
      const album = raw.albuminfo && typeof raw.albuminfo === 'object' ? record(raw.albuminfo, 'kugou.album') : {};
      const trans = raw.trans_param && typeof raw.trans_param === 'object' ? record(raw.trans_param, 'kugou.track.extra') : {};
      const cover = [raw.cover, raw.img, album.img, album.cover, album.sizable_cover, trans.union_cover].find(value => typeof value === 'string' && value.length > 0);
      items.push({ track: { id: hash, name, artists, durationMs }, hash,
        ...(typeof cover === 'string' && cover ? { cover } : {}),
        ...(typeof album.name === 'string' ? { album: album.name.slice(0, 500) } : {}),
      });
    } catch { /* 跳过无法安全解析的单条记录 */ }
  }
  if (value.length > 0 && items.length === 0) throw new DomainError('invalid-response');
  return { items, received: value.length };
}
function debugKugou(message: string): void {
  if (process.env.STARSMUSIC_DEBUG === '1') console.error(`[kugou-debug] ${message}`);
}
function canFallbackPreview(error: unknown): boolean {
  return error instanceof DomainError && ['permission-denied', 'unavailable', 'playback-access-unknown'].includes(error.code);
}
function normalizeName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\.(?:mp3|flac|m4a|aac|ogg|wav|ape)$/i, '').replace(/[^\p{L}\p{N}]+/gu, '');
}
function namesMatch(expected: string, fileName: string, artists: readonly string[] = []): boolean {
  // 只比较完整名称。共享歌手、一个词或相似片段不能证明是同一首歌。
  const artistNames = new Set([...artists.map(normalizeName), normalizeName(artists.join('、'))].filter(Boolean));
  const stripKnownArtist = (value: string): string => {
    const parts = value.split(/\s*[-–—]\s*/);
    return parts.length > 1 && artistNames.has(normalizeName(parts[0]!)) ? parts.slice(1).join('-') : value;
  };
  const left = normalizeName(stripKnownArtist(expected)); const right = normalizeName(stripKnownArtist(fileName));
  if (!left || !right) return false;
  if (left === right) return true;
  // 云歌单和取链接口可能分别返回「歌手 - 歌名」或单独歌名。
  const title = (value: string) => normalizeName(stripKnownArtist(value).replace(/^.*?\s+[-–—]\s+/, ''));
  return title(expected) === title(fileName);
}
export interface KugouResourceIdentity {
  readonly hash: string;
  readonly hashes: readonly string[];
  readonly name: string;
}
export function parseKugouResourceIdentity(value: unknown, hash: string): KugouResourceIdentity {
  if (!/^[a-f0-9]{32}$/.test(hash)) throw new DomainError('invalid-input');
  const raw = success(value);
  if (!Array.isArray(raw.data)) throw new DomainError('invalid-response');
  const matches = raw.data.filter((value: unknown) => {
    const row = record(value, 'kugou.resource');
    return typeof row.hash === 'string' && row.hash.toLowerCase() === hash;
  });
  // 不按数组位置配对，也不接受另一条资源的编码列表。
  if (matches.length !== 1) throw new DomainError('track-mismatch');
  const item = record(matches[0], 'kugou.resource');
  const name = text(item.name, 'kugou.resource.name');
  const hashes = new Set([hash]);
  const add = (value: unknown): void => {
    if (typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value)) hashes.add(value.toLowerCase());
  };
  if (Array.isArray(item.relate_goods)) {
    for (const value of item.relate_goods) add(record(value, 'kugou.resource.encoding').hash);
  }
  if (item.trans_param !== undefined) {
    const variants = record(item.trans_param, 'kugou.resource.variants');
    add(variants.ogg_128_hash); add(variants.ogg_320_hash);
  }
  return Object.freeze({ hash, name, hashes: Object.freeze([...hashes]) });
}
function decodedFileName(value: unknown): string {
  if (typeof value !== 'string') return '';
  try { return decodeURIComponent(value); } catch { return value; }
}
function fullAudioFlag(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  throw new DomainError('invalid-response');
}
function previewAccess(raw: Record<string, unknown>): StreamResolution['access'] {
  const start = optionalInteger(raw.free_part_start, 'kugou.preview.start');
  const end = optionalInteger(raw.free_part_end, 'kugou.preview.end');
  // timeLength 是资源时长，不是授权的试听上限，禁止用它或默认 30 秒补出权限。
  if (start === undefined || end === undefined || end <= start) throw new DomainError('playback-access-unknown');
  return { kind: 'preview', startMs: 0, durationMs: end - start };
}
export function parseKugouStream(value: unknown, id: string, expected?: { name: string; durationMs: number; artists?: readonly string[] }, mode: 'full' | 'preview' = 'full', identity?: KugouResourceIdentity): StreamResolution {
  let raw: Record<string, unknown>;
  try { raw = success(value); } catch (error: unknown) {
    const body = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
    debugKugou(`stream response rejected mode=${mode} status=${String(body.status)} error=${String(body.error_code)} keys=${Object.keys(body).sort().join(',')}`);
    throw error;
  }
  debugKugou(`stream keys=${Object.keys(raw).sort().join(',')}`);
  if (!Array.isArray(raw.url) || typeof raw.url[0] !== 'string' || !raw.url[0]) throw new DomainError('unavailable');
  if (/[\u0000-\u0020\u007f]/.test(raw.url[0])) throw new DomainError('invalid-response');
  let url: URL;
  try { url = new URL(raw.url[0]); } catch {
    debugKugou('stream url parse failed');
    throw new DomainError('invalid-response');
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (!allowedKugouMediaHost(url.hostname) || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) {
    debugKugou(`media-url rejected host=${url.hostname} protocol=${url.protocol} port=${url.port ? 'set' : 'none'} auth=${url.username || url.password ? 'set' : 'none'} fragment=${url.hash ? 'set' : 'none'}`);
    throw new DomainError('invalid-response');
  }
  const fileName = decodedFileName(raw.fileName);
  const nameMatch = expected !== undefined && fileName ? namesMatch(expected.name, fileName, expected.artists) : undefined;
  const responseHash = typeof raw.hash === 'string' ? raw.hash.toLowerCase() : '';
  const standardHash = typeof raw.std_hash === 'string' ? raw.std_hash.toLowerCase() : '';
  if (identity && identity.hash !== id) throw new DomainError('track-mismatch');
  if (identity && expected && !namesMatch(expected.name, identity.name, expected.artists)) throw new DomainError('track-mismatch');
  const verifiedHashes = identity?.hashes ?? [];
  const hashMatches = responseHash === id || standardHash === id || verifiedHashes.includes(responseHash) || verifiedHashes.includes(standardHash);
  const responseTimeLength = optionalInteger(raw.timeLength, 'kugou.timeLength');
  const responseSeconds = responseTimeLength === undefined ? undefined : responseTimeLength > 10000 ? responseTimeLength / 1000 : responseTimeLength;
  const expectedSeconds = expected !== undefined && expected.durationMs > 0 ? expected.durationMs / 1000 : undefined;
  const durationMatches = expectedSeconds === undefined || responseSeconds === undefined || Math.abs(responseSeconds - expectedSeconds) <= 10;
  const bitrateRaw = optionalInteger(raw.bitRate, 'kugou.bitRate');
  const bitrate = bitrateRaw !== undefined && bitrateRaw > 0 ? bitrateRaw / 1000 : undefined;
  const ext = typeof raw.extName === 'string' ? raw.extName.toLowerCase() : '';
  const quality = { level: ext === 'flac' ? 'lossless' as const : bitrate === undefined ? 'unknown' as const : bitrate > 128 ? 'high' as const : 'standard' as const,
    ...(bitrate ? { bitrateKbps: bitrate } : {}), ...(['mp3', 'flac', 'm4a', 'ogg', 'aac'].includes(ext) ? { codec: ext } : {}) };
  debugKugou(`media host accepted mode=${mode} host=${url.hostname} request=${id.slice(0, 6)} response=${responseHash ? responseHash.slice(0, 6) : 'none'} std=${standardHash ? standardHash.slice(0, 6) : 'none'} match=${hashMatches} expected=${expectedSeconds === undefined ? 'none' : Math.round(expectedSeconds)} responseTime=${responseSeconds === undefined ? 'none' : Math.round(responseSeconds)} durationMatch=${durationMatches} nameMatch=${nameMatch === undefined ? 'unknown' : nameMatch} fileName=${fileName ? 'set' : 'none'} priv=${String(raw.priv_status)} full=${String(raw.is_full_audio)} freeStart=${typeof raw.free_part_start} freeEnd=${typeof raw.free_part_end} ext=${typeof raw.extName} bitRate=${typeof raw.bitRate}`);
  // 明确冲突的文件名在 hash 相同的情况下也不能放行；时长接近更不能替代身份。
  if (nameMatch === false) throw new DomainError('track-mismatch');
  // 完整资源须匹配原 hash 或后台核验的同曲编码；试听另 hash 仍要求名称、歌手和有效范围。
  if (mode === 'full' && !hashMatches) throw new DomainError('track-mismatch');
  if (mode === 'preview' && !hashMatches) {
    const parts = fileName.split(/\s+-\s+/);
    const expectedArtist = expected?.artists?.join('、') || expected?.name.split(/\s+-\s+/).slice(0, -1).join(' - ') || '';
    const artistMatch = parts.length > 1 && Boolean(expectedArtist) && normalizeName(parts.slice(0, -1).join(' - ')) === normalizeName(expectedArtist);
    if (nameMatch !== true || !artistMatch) throw new DomainError('track-mismatch');
  }
  const privileged = optionalInteger(raw.priv_status, 'kugou.priv_status');
  const fullAudio = fullAudioFlag(raw.is_full_audio);
  const previewStart = optionalInteger(raw.free_part_start, 'kugou.preview.start');
  const previewEnd = optionalInteger(raw.free_part_end, 'kugou.preview.end');
  const hasPreviewRange = (previewStart ?? 0) > 0 || (previewEnd ?? 0) > 0;
  let access: StreamResolution['access'];
  if (fullAudio === true) {
    // 完整权限仍必须绑定 hash；不能拿同名试听响应冒充另一编码的完整歌曲。
    if (!hashMatches) throw new DomainError('track-mismatch');
    access = { kind: 'full' };
  } else if (mode === 'preview' || fullAudio === false || hasPreviewRange || (privileged !== undefined && privileged !== 0)) {
    access = previewAccess(raw);
  } else if (privileged === 0) {
    access = { kind: 'full' };
  } else {
    throw new DomainError('playback-access-unknown');
  }
  try {
    return parseStreamResolution({ track: { provider: 'kugou', id }, source: { kind: 'remote', url: url.href, headers: {} }, quality, access });
  } catch (error: unknown) {
    debugKugou(`stream resolution rejected priv=${typeof raw.priv_status} freeStart=${typeof raw.free_part_start} freeEnd=${typeof raw.free_part_end} ext=${typeof raw.extName} bitRate=${typeof raw.bitRate}`);
    throw error;
  }
}

interface ServiceOptions {
  artwork?: LoadArtwork;
  lyricRequest?: LyricRequest;
  transport?: () => KugouTransport;
  encodeQr?: (url: string) => Promise<string>;
  now?: () => number;
  autoPoll?: boolean;
  onCredentials?: (bundle: KugouCredentialBundle) => void;
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
  #resolution = 0;
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
        this.#emitCredentials();
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
  #emitCredentials(): void {
    try {
      const bundle = this.exportCredentials();
      if (bundle) this.#options.onCredentials?.(bundle);
    } catch { /* 保存失败不影响当前登录 */ }
  }
  exportCredentials(): KugouCredentialBundle | undefined {
    if (this.#state.status !== 'connected' || !this.#state.account || !this.#transport) return undefined;
    const session = this.#transport.exportSession();
    if (!session) return undefined;
    const parsed = parseCredentialBundle({
      provider: 'kugou', version: 1, clientChannel: 'kugou-app',
      accountId: this.#state.account.id, nickname: this.#state.account.nickname,
      userid: session.userid, token: session.token, dfid: session.dfid, guid: session.guid, savedAt: this.#now(),
    });
    return parsed.provider === 'kugou' ? parsed : undefined;
  }
  async restoreCredentials(value: unknown): Promise<KugouSnapshot> {
    const bundle = parseCredentialBundle(value);
    if (bundle.provider !== 'kugou') throw new DomainError('invalid-response');
    this.#clear(); this.#diagnostic = undefined;
    const lease = this.#sessions.activate({ provider: 'kugou', clientChannel: 'kugou-app', accountId: bundle.accountId });
    this.#lease = lease;
    const transport = this.#options.transport?.() ?? new DirectKugouTransport();
    this.#transport = transport;
    try {
      transport.restoreSession({ userid: bundle.userid, token: bundle.token, dfid: bundle.dfid, guid: bundle.guid });
      this.#update({ ...initialKugouSnapshot(), generation: lease.generation, status: 'verifying', busy: true });
      const profile = record(success(await transport.call('account', {}, lease.signal)).data, 'kugou.profile');
      const echoedId = profile.userid ?? profile.user_id ?? profile.uid;
      if (echoedId !== undefined && numericId(echoedId) !== bundle.accountId) throw new DomainError('session-expired');
      const nickname = text(profile.nickname ?? profile.username ?? profile.user_name, 'kugou.nickname');
      if (!this.#sessions.isCurrent(lease)) return this.#state;
      const connected = this.#sessions.activate({ provider: 'kugou', clientChannel: 'kugou-app', accountId: bundle.accountId });
      this.#lease = connected;
      this.#update({ status: 'connected', generation: connected.generation, account: { id: bundle.accountId, nickname }, error: undefined });
      this.#emitCredentials();
    } catch (error: unknown) {
      if (this.#sessions.isCurrent(lease)) {
        const safe = normalizeError(error);
        const invalid = ['session-expired', 'unauthenticated', 'permission-denied', 'invalid-response'].includes(safe.code);
        this.#end(invalid ? 'expired' : 'failed', safe);
      }
    }
    return this.#state;
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
  async getPresentation(id: string, generation: number): Promise<PresentationContent> {
    const { lease, transport } = this.#connected();
    const item = this.#knownTracks.get(kugouId(id));
    if (generation !== this.#state.generation || !item) throw new DomainError('stale-operation');
    const [lyrics, artwork] = await Promise.allSettled([
      getKugouLyrics(item.track, lease.signal, this.#options.lyricRequest),
      (async () => {
        let cover = item.cover;
        if (!cover) {
          const raw = success(await transport.call('resource', { hash: item.hash }, lease.signal));
          if (Array.isArray(raw.data)) {
            const matching = raw.data.filter(value => { const row = record(value, 'kugou.resource'); return typeof row.hash === 'string' && row.hash.toLowerCase() === item.hash; });
            if (matching.length === 1) {
              const row = record(matching[0], 'kugou.resource');
              if (typeof row.name === 'string' && !namesMatch(item.track.name, row.name, item.track.artists)) throw new DomainError('track-mismatch');
              const trans = row.trans_param ? record(row.trans_param, 'kugou.cover') : {};
              if (typeof trans.union_cover === 'string') cover = trans.union_cover;
            }
          }
        }
        return cover ? (this.#options.artwork ?? loadArtwork)(cover, 'kugou', lease.signal) : undefined;
      })(),
    ]);
    if (!this.#sessions.isCurrent(lease)) throw new DomainError('stale-operation');
    return parsePresentationContent({ lyrics: lyrics.status === 'fulfilled' ? lyrics.value : [],
      ...(artwork.status === 'fulfilled' && artwork.value ? { artwork: artwork.value } : {}),
      ...(item.album ? { album: item.album } : {}),
      ...(lyrics.status === 'rejected' ? { lyricsError: normalizeError(lyrics.reason) } : {}),
      ...(artwork.status === 'rejected' ? { artworkError: normalizeError(artwork.reason) } : {}),
    });
  }
  async resolveTrack(id: string, generation: number): Promise<StreamResolution> {
    const { lease, transport } = this.#connected();
    if (generation !== this.#state.generation || !this.#knownTracks.has(kugouId(id))) throw new DomainError('stale-operation');
    const item = this.#knownTracks.get(id)!;
    const resolution = ++this.#resolution;
    this.#update({ error: undefined });
    // 只按 hash 取链；歌单里的 album_id/album_audio_id 可能与 hash 错配，导致平台返回别的歌曲。
    const request = (freePart: boolean) => transport.call('stream', { hash: item.hash, freePart }, lease.signal);
    let identity: KugouResourceIdentity | undefined;
    const parse = async (value: unknown, mode: 'full' | 'preview'): Promise<StreamResolution> => {
      try { return parseKugouStream(value, id, item.track, mode); }
      catch (error: unknown) {
        if (!(error instanceof DomainError) || error.code !== 'track-mismatch') throw error;
        identity ??= parseKugouResourceIdentity(await transport.call('resource', { hash: item.hash }, lease.signal), item.hash);
        if (!this.#sessions.isCurrent(lease) || resolution !== this.#resolution) throw new DomainError('stale-operation');
        return parseKugouStream(value, id, item.track, mode, identity);
      }
    };
    try {
      try {
        const value = await request(false);
        if (!this.#sessions.isCurrent(lease) || resolution !== this.#resolution) throw new DomainError('stale-operation');
        return await parse(value, 'full');
      } catch (error: unknown) {
        // 完整资源不可用或权限未确认时只回退一次；身份不一致不再走更宽松的试听判断。
        if (!canFallbackPreview(error) || !this.#sessions.isCurrent(lease) || resolution !== this.#resolution) throw error;
      }
      const preview = await request(true);
      if (!this.#sessions.isCurrent(lease) || resolution !== this.#resolution) throw new DomainError('stale-operation');
      return await parse(preview, 'preview');
    } catch (error: unknown) { if (resolution === this.#resolution) this.#operationError(lease, error); throw error; }
  }
}
