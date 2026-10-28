import { parseStoredPlaybackTrack, type StoredRemoteTrack } from '../../../contracts/src/playback-session.ts';
import { getKugouLyrics, type LyricRequest } from './lyrics.ts';
import { parsePresentationContent, type PresentationContent } from '../../../contracts/src/presentation.ts';
import { artworkUrl, loadArtwork, type LoadArtwork } from '../artwork.ts';
import { parseKugouArtwork, parseKugouArtworkRequest, type KugouArtworkRequest } from '../../../contracts/src/kugou-artwork.ts';
import { parseKugouCatalog, parseKugouCatalogRequest, type KugouCatalogRequest, type KugouCatalogPlaylist } from '../../../contracts/src/kugou-catalog.ts';
import { fetchKugouCatalog, publicPlaylistPage } from './catalog.ts';
import QRCode from 'qrcode';
import { DomainError, normalizeError } from '../../../contracts/src/errors.ts';
import { parseCredentialBundle, type KugouCredentialBundle } from '../../../contracts/src/credentials.ts';
import { initialKugouSnapshot, kugouId, kugouTrackPageSize, parseKugouSnapshot, type KugouSnapshot, type KugouTrack, type KugouLoginDiagnostic } from '../../../contracts/src/kugou.ts';
import { parseStreamResolution, type StreamResolution } from '../../../contracts/src/music.ts';
import { allowedKugouMediaHost } from '../../../contracts/src/media-policy.ts';
import { nonNegativeInteger, record, text } from '../../../contracts/src/validation.ts';
import { SessionGeneration, type SessionLease } from '../session-generation.ts';
import { DirectKugouTransport, type KugouTransport } from './transport.ts';

import { integerValue, numericId, optionalInteger, parseTracks, success, type BackendTrack } from './response.ts';
import { standardBenefits, unionBenefits } from './rights.ts';
import type { KugouMembership, KugouTrackRights } from '../../../contracts/src/kugou-rights.ts';
const trackPageSize = kugouTrackPageSize;
export { apiId } from './response.ts';
function debugKugou(message: string): void {
  if (process.env.STARSMUSIC_DEBUG === '1') console.error(`[kugou-debug] ${message}`);
}
function canFallbackPreview(error: unknown): boolean {
  return error instanceof DomainError && ['permission-denied', 'unavailable', 'playback-access-unknown'].includes(error.code);
}
function normalizeName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\.(?:mp3|flac|m4a|aac|ogg|wav|ape)$/i, '').replace(/[^\p{L}\p{N}]+/gu, '');
}
function withoutExplicitAlias(value: string): string {
  return value.normalize('NFKC').replace(/\s*\((?:又名|别名|原名)\s*:[^()]+\)\s*$/u, '').trim();
}
function withoutVersionSuffix(value: string): string {
  return value.normalize('NFKC').replace(/\.(?:mp3|flac|m4a|aac|ogg|wav|ape)$/i, '').replace(/(?:\s*\([^()]*\))+\s*$/u, '').trim();
}
function namesMatch(expected: string, fileName: string, artists: readonly string[] = []): boolean {
  // 只比较完整名称。共享歌手、一个词或相似片段不能证明是同一首歌。
  const artistNames = new Set([...artists.map(normalizeName), normalizeName(artists.join('、'))].filter(Boolean));
  const stripKnownArtist = (value: string): string => {
    const parts = value.split(/\s*[-–—]\s*/);
    if (parts.length > 1 && artistNames.has(normalizeName(parts[0]!))) return parts.slice(1).join('-');
    if (parts.length > 1 && artistNames.has(normalizeName(parts.at(-1)!))) return parts.slice(0, -1).join('-');
    return value;
  };
  const left = normalizeName(withoutExplicitAlias(stripKnownArtist(expected))); const right = normalizeName(withoutExplicitAlias(stripKnownArtist(fileName)));
  if (!left || !right) return false;
  if (left === right) return true;
  // 云歌单和取链接口可能分别返回「歌手 - 歌名」或单独歌名。
  const title = (value: string) => normalizeName(withoutExplicitAlias(stripKnownArtist(value).replace(/^.*?\s+[-–—]\s+/, '')));
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
  if (identity && expected && !namesMatch(expected.name, identity.name, expected.artists)
    && !namesMatch(expected.name, withoutVersionSuffix(identity.name), expected.artists)) throw new DomainError('track-mismatch');
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
  // 播放响应的 fileName 可能省略 Remix/Live 等版本信息。只有资源详情的完整名称
  // 已匹配所选版本，且实际返回 hash 明确属于该资源时，才以资源详情纠正文件名。
  // 仅 std_hash 相同、曲名相似或时长接近都不能消除文件名冲突。
  const versionlessName = expected === undefined ? undefined : withoutVersionSuffix(expected.name);
  // 云歌单可能没有 singerinfo；资源详情已按 hash 和完整曲名核验后，可使用它的歌手前缀。
  const resourceArtists = [...(expected?.artists ?? []), ...(identity?.name.split(/\s+[-–—]\s+/).slice(0, -1) ?? [])];
  // 部分资源只给出「hash - 数字编号.mp/wa」而非歌名。只识别绑定到实际 hash 的
  // 固定格式，并仍要求资源详情的完整名称和编码关系已通过核验。
  const opaqueFile = fileName.match(/^([a-f0-9]{32})\s+-\s+\d{1,30}\.(?:mp|wa|mp3|wav|flac|m4a|aac|ogg)$/i);
  const opaqueHashMatches = opaqueFile?.[1] !== undefined && verifiedHashes.includes(opaqueFile[1].toLowerCase());
  const resourceConfirmsFile = expected !== undefined && identity !== undefined && verifiedHashes.includes(responseHash)
    && (opaqueHashMatches || (versionlessName !== undefined && versionlessName.length > 0 && namesMatch(versionlessName, fileName, resourceArtists)));
  if (nameMatch === false && !resourceConfirmsFile) throw new DomainError('track-mismatch');
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
  #likedPlaylists = new Set<string>();
  #likedTracks = new Map<string, readonly BackendTrack[]>();
  #knownTracks = new Map<string, BackendTrack>();
  #listBusy = false;
  #pollingLease: SessionLease | undefined;
  #guestTransport: KugouTransport | undefined;
  #catalogView = 0;
  #catalogAbort: AbortController | undefined;
  #queueAbort: AbortController | undefined;
  #publicPlaylists = new Map<string, KugouCatalogPlaylist>();
  #playlistCovers = new Map<string, string>();
  #artworkAbort = new AbortController();
  #artworkCache = new Map<string, string | null>();
  #artworkPending = new Map<string, Promise<string | null>>();
  #membershipRequest: Promise<KugouSnapshot> | undefined;
  #membershipSources: [KugouMembership['benefits'], KugouMembership['benefits']] = [[], []];

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
    this.#likedPlaylists.clear(); this.#likedTracks.clear();
    this.#guestTransport?.clear(); this.#guestTransport = undefined;
    this.#catalogAbort?.abort(); this.#queueAbort?.abort(); this.#catalogView++;
    this.#artworkAbort.abort(); this.#artworkAbort = new AbortController();
    this.#publicPlaylists.clear(); this.#playlistCovers.clear(); this.#artworkCache.clear(); this.#artworkPending.clear();
    this.#membershipRequest = undefined; this.#membershipSources = [[], []];
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
        void this.#syncMembership(profile);
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
      void this.#syncMembership(profile);
    } catch (error: unknown) {
      if (this.#sessions.isCurrent(lease)) {
        const safe = normalizeError(error);
        const invalid = ['session-expired', 'unauthenticated', 'permission-denied', 'invalid-response'].includes(safe.code);
        this.#end(invalid ? 'expired' : 'failed', safe);
      }
    }
    return this.#state;
  }
  refreshMembership(): Promise<KugouSnapshot> { return this.#syncMembership(); }
  #syncMembership(profile?: Record<string, unknown>): Promise<KugouSnapshot> {
    if (this.#membershipRequest) return this.#membershipRequest;
    const { lease, transport } = this.#connected();
    this.#update({ membership: { status: 'loading', benefits: this.#state.membership.benefits } });
    const operation = (async () => {
      const now = this.#now();
      const results = await Promise.allSettled([
        (async () => standardBenefits(profile ?? record(success(await transport.call('account', {}, lease.signal)).data, 'kugou.membership.account'), lease.context.accountId!, now))(),
        (async () => unionBenefits(await transport.call('membership', {}, lease.signal), lease.context.accountId!, now))(),
      ]);
      if (!this.#sessions.isCurrent(lease)) return this.#state;
      for (const [index, result] of results.entries()) {
        if (result.status === 'fulfilled') this.#membershipSources[index as 0 | 1] = result.value;
      }
      // Cache only normalized benefits, per source and current account. A
      // successful non-member response clears that source; a transient failure
      // keeps its last confirmed, still-active benefits with an error status.
      const benefits = [...new Map(this.#membershipSources.flat()
        .filter(item => (item.expiresAt === undefined || item.expiresAt > now) && (item.startsAt === undefined || item.startsAt <= now))
        .map(item => [JSON.stringify(item), item])).values()];
      const failure = results.find(result => result.status === 'rejected');
      this.#update({ membership: { status: failure ? 'error' : 'ready', benefits, syncedAt: now,
        ...(failure?.status === 'rejected' ? { error: normalizeError(failure.reason) } : {}) } });
      return this.#state;
    })();
    this.#membershipRequest = operation;
    void operation.finally(() => { if (this.#membershipRequest === operation) this.#membershipRequest = undefined; });
    return operation;
  }
  #trackAccess(id: string, playback: KugouTrackRights['playback']): void {
    const item = this.#knownTracks.get(id); if (!item) return;
    const track = { ...item.track, rights: { fee: item.track.rights?.fee ?? 'unknown', playback } };
    this.#knownTracks.set(id, { ...item, track });
    this.#update({ tracks: this.#state.tracks.map(value => value.id === id ? track : value),
      catalog: { ...this.#state.catalog, tracks: this.#state.catalog.tracks.map(value => value.id === id ? track : value) } });
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
      const likedRows = new Set<unknown>();
      if (Array.isArray(info)) rows = info;
      else {
        const groups = record(info ?? data, 'kugou.playlist.groups');
        const names = ['collect', 'love', 'self', 'list'];
        if (!names.some((key) => Array.isArray(groups[key]))) throw new DomainError('invalid-response');
        rows = names.flatMap((key) => Array.isArray(groups[key]) ? groups[key] as unknown[] : []);
        if (Array.isArray(groups.love)) for (const row of groups.love) likedRows.add(row);
      }
      const entries = rows.map((value: unknown) => {
        const item = record(value, 'kugou.playlist');
        const id = numericId(item.list_create_listid ?? item.listid);
        const cover = item.pic ?? item.img ?? item.cover ?? item.imgurl;
        const type = nonNegativeInteger(item.type ?? 0, 'kugou.type');
        return { id, name: text(item.name ?? item.listname, 'kugou.playlist.name'), trackCount: integerValue(item.count ?? item.song_count ?? 0, 'kugou.count'), type, liked: likedRows.has(value) || (type === 0 && id === '2'), ...(typeof cover === 'string' && cover ? { cover } : {}) };
      });
      this.#sessions.commit(lease, () => {
        this.#playlistOffset += 50;
        for (const item of entries) {
          this.#knownPlaylists.set(item.id, item.type);
          if (item.liked) this.#likedPlaylists.add(item.id); else this.#likedPlaylists.delete(item.id);
          if (item.cover) this.#playlistCovers.set(item.id, item.cover);
        }
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
      if (this.#likedPlaylists.has(id)) {
        // 官方“我喜欢”以最新收藏在前。先获取完整有界列表再反转，避免逐页反转造成跨页错序。
        const items = offset === 0 ? await this.#readLikedTracks(id, transport, lease.signal) : this.#likedTracks.get(id);
        if (!items) throw new DomainError('invalid-input');
        if (view !== this.#view) return this.#state;
        this.#sessions.commit(lease, () => {
          this.#likedTracks.set(id, items);
          const page = items.slice(offset, offset + trackPageSize);
          for (const item of page) this.#knownTracks.set(item.track.id, item);
          this.#update({ tracks: [...(offset === 0 ? [] : this.#state.tracks), ...page.map(item => item.track)],
            nextTrackOffset: offset + trackPageSize, tracksMore: offset + trackPageSize < items.length, busy: false });
        });
        return this.#state;
      }
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
  async #readLikedTracks(id: string, transport: KugouTransport, signal: AbortSignal): Promise<readonly BackendTrack[]> {
    const items = new Map<string, BackendTrack>();
    for (let offset = 0; offset < 10000; offset += trackPageSize) {
      const data = record(success(await transport.call('playlist', { id, type: this.#knownPlaylists.get(id), page: offset / trackPageSize + 1 }, signal)).data, 'kugou.liked');
      signal.throwIfAborted();
      const rows = data.info ?? data.songs ?? data.lists ?? data.file;
      const parsed = parseTracks(rows === undefined && offset > 0 ? [] : Array.isArray(rows) ? rows : record(rows, 'kugou.files').file);
      const total = optionalInteger(data.count ?? data.total, 'kugou.liked.total');
      if ((total ?? 0) > 10000) throw new DomainError('unavailable');
      if (parsed.received > trackPageSize || (total !== undefined && offset + parsed.received < total && parsed.received < trackPageSize)) throw new DomainError('invalid-response');
      for (const item of parsed.items) items.set(item.track.id, item);
      if (items.size > 10000) throw new DomainError('unavailable');
      if (parsed.received < trackPageSize || (total !== undefined && offset + parsed.received >= total)) return Object.freeze([...items.values()].reverse());
      if (offset + trackPageSize >= 10000) throw new DomainError('unavailable');
    }
    throw new DomainError('unavailable');
  }
  async ensureRestoredTrack(value: StoredRemoteTrack, generation: number): Promise<void> {
    const saved = parseStoredPlaybackTrack(value);
    const { lease } = this.#connected();
    if (saved.kind !== 'kugou' || saved.accountId !== lease.context.accountId || generation !== this.#state.generation) throw new DomainError('stale-operation');
    if (this.#knownTracks.has(saved.sourceId)) return;
    this.#knownTracks.set(saved.sourceId, { hash: saved.sourceId,
      track: { id: saved.sourceId, name: saved.title, artists: saved.artist ? saved.artist.split('、') : [], durationMs: saved.durationMs ?? 0 } });
  }
  async browse(input: KugouCatalogRequest): Promise<KugouSnapshot> {
    const request = parseKugouCatalogRequest(input);
    if (request.kind === 'playlist' && !this.#publicPlaylists.has(request.id)) throw new DomainError('invalid-input');
    const view = ++this.#catalogView; this.#catalogAbort?.abort();
    const controller = new AbortController(); this.#catalogAbort = controller;
    const generation = this.#state.generation;
    const connected = this.#state.status === 'connected';
    const transport = connected ? this.#transport! : (this.#guestTransport ??= this.#options.transport?.() ?? new DirectKugouTransport());
    const signal = connected && this.#lease ? AbortSignal.any([controller.signal, this.#lease.signal]) : controller.signal;
    this.#update({ catalog: parseKugouCatalog({ ...this.#state.catalog, kind: request.kind, offset: request.offset,
      ...(request.kind === 'search' ? { query: request.query, searchType: request.searchType } : {}),
      ...(request.kind === 'playlist' ? { playlist: this.#publicPlaylists.get(request.id) } : { playlist: undefined }),
      tracks: [], playlists: [], more: false, total: 0, status: 'loading', error: undefined }) });
    try {
      const result = await fetchKugouCatalog(request, this.#state.catalog, transport, signal);
      if (generation !== this.#state.generation || view !== this.#catalogView || signal.aborted) return this.#state;
      for (const item of result.tracks) this.#knownTracks.set(item.track.id, item);
      for (const item of result.playlists) { this.#publicPlaylists.set(item.playlist.id, item.playlist); if (item.cover) this.#playlistCovers.set(item.playlist.id, item.cover); }
      this.#update({ catalog: result.catalog });
    } catch (error: unknown) {
      if (generation === this.#state.generation && view === this.#catalogView && !signal.aborted) this.#update({ catalog: { ...this.#state.catalog, status: 'error', error: normalizeError(error) } });
    }
    return this.#state;
  }
  async getArtwork(input: KugouArtworkRequest): Promise<string | null> {
    const { id, kind, generation } = parseKugouArtworkRequest(input);
    if (generation !== this.#state.generation) throw new DomainError('stale-operation');
    if (kind === 'track' ? !this.#knownTracks.has(id) : !this.#knownPlaylists.has(id) && !this.#publicPlaylists.has(id)) throw new DomainError('invalid-input');
    const key = `${kind}:${id}`;
    if (this.#artworkCache.has(key)) return this.#artworkCache.get(key)!;
    const pending = this.#artworkPending.get(key); if (pending) return pending;
    if (this.#artworkPending.size >= 4) throw new DomainError('unavailable');
    const cover = kind === 'track' ? this.#knownTracks.get(id)?.cover : this.#playlistCovers.get(id);
    if (!cover) return null;
    const url = artworkUrl(cover, 'kugou'); const signal = this.#artworkAbort.signal;
    const operation = (async () => {
      const image = parseKugouArtwork(await (this.#options.artwork ?? loadArtwork)(url.href, 'kugou', signal));
      if (signal.aborted || generation !== this.#state.generation) throw new DomainError('stale-operation');
      this.#artworkCache.set(key, image); while (this.#artworkCache.size > 32) this.#artworkCache.delete(this.#artworkCache.keys().next().value!);
      return image;
    })();
    this.#artworkPending.set(key, operation);
    try { return await operation; } finally { if (this.#artworkPending.get(key) === operation) this.#artworkPending.delete(key); }
  }
  async preparePlaylist(id: string, source: 'public' | 'owned'): Promise<readonly KugouTrack[]> {
    kugouId(id); const { lease, transport } = this.#connected();
    if (source !== 'public' && source !== 'owned') throw new DomainError('invalid-input');
    if (source === 'public' ? !this.#publicPlaylists.has(id) : !this.#knownPlaylists.has(id)) throw new DomainError('invalid-input');
    this.#queueAbort?.abort(); const controller = new AbortController(); this.#queueAbort = controller;
    const signal = AbortSignal.any([lease.signal, controller.signal]); const items = new Map<string, BackendTrack>();
    for (let offset = 0; offset < 10000; offset += trackPageSize) {
      signal.throwIfAborted();
      let page: { tracks: BackendTrack[]; received: number; total?: number };
      if (source === 'public') page = await publicPlaylistPage(id, offset, trackPageSize, transport, signal);
      else {
        const data = record(success(await transport.call('playlist', { id, type: this.#knownPlaylists.get(id), page: offset / trackPageSize + 1 }, signal)).data, 'kugou.queue.playlist');
        const rows = data.info ?? data.songs ?? data.lists ?? data.file;
        const parsed = parseTracks(rows === undefined && offset > 0 ? [] : Array.isArray(rows) ? rows : record(rows, 'kugou.files').file);
        if (parsed.received > trackPageSize) throw new DomainError('invalid-response');
        page = { tracks: parsed.items, received: parsed.received, ...(data.count === undefined && data.total === undefined ? {} : { total: integerValue(data.count ?? data.total, 'kugou.queue.total') }) };
      }
      if (signal.aborted || !this.#sessions.isCurrent(lease)) throw new DomainError('stale-operation');
      if ((page.total ?? 0) > 10000) throw new DomainError('unavailable');
      for (const item of page.tracks) items.set(item.track.id, item);
      if (items.size > 10000 || (page.total !== undefined && offset + page.received < page.total && page.received < trackPageSize)) throw new DomainError('invalid-response');
      if (page.received < trackPageSize || (page.total !== undefined && offset + page.received >= page.total)) break;
      if (offset + trackPageSize >= 10000) throw new DomainError('unavailable');
    }
    if (!items.size) throw new DomainError('unavailable');
    for (const [id, item] of items) this.#knownTracks.set(id, item);
    const ordered = [...items.values()];
    if (source === 'owned' && this.#likedPlaylists.has(id)) ordered.reverse();
    return Object.freeze(ordered.map(item => item.track));
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
    const current = (): void => {
      if (!this.#sessions.isCurrent(lease) || resolution !== this.#resolution) throw new DomainError('stale-operation');
    };
    this.#update({ error: undefined });
    // 只按 hash 取链；歌单里的 album_id/album_audio_id 可能与 hash 错配，导致平台返回别的歌曲。
    const request = (freePart: boolean) => transport.call('stream', { hash: item.hash, freePart }, lease.signal);
    let identity: KugouResourceIdentity | undefined;
    let identityRequest: Promise<KugouResourceIdentity> | undefined;
    const parse = async (value: unknown, mode: 'full' | 'preview'): Promise<StreamResolution> => {
      let result: StreamResolution;
      try { result = parseKugouStream(value, id, item.track, mode); }
      catch (error: unknown) {
        if (!(error instanceof DomainError) || error.code !== 'track-mismatch') throw error;
        identity ??= await (identityRequest ??= transport.call('resource', { hash: item.hash }, lease.signal).then(value => parseKugouResourceIdentity(value, item.hash)));
        if (!this.#sessions.isCurrent(lease) || resolution !== this.#resolution) throw new DomainError('stale-operation');
        result = parseKugouStream(value, id, item.track, mode, identity);
      }
      if (!this.#sessions.isCurrent(lease) || resolution !== this.#resolution) throw new DomainError('stale-operation');
      this.#trackAccess(id, result.access.kind === 'full' ? 'full' : 'preview');
      return result;
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
      let previewError: unknown;
      try { const preview = await request(true); current(); return await parse(preview, 'preview'); }
      catch (error: unknown) { current(); if (!canFallbackPreview(error)) throw error; previewError = error; }
      // 旧取链不可用/权限不明确时，在同一个标准版会话中走官方授权链一次。
      // 不使用歌单中的 album ID，不混用概念版或网页 Token；每个等待点丢弃旧请求。
      try {
        const verification = await transport.call('verifyPlayback', {}, lease.signal); current();
        const account = record(success(verification).data, 'kugou.playback.account');
        if (integerValue(account.valid, 'kugou.playback.valid') !== 1) throw new DomainError('permission-denied');
        const authorization = text(account.auth, 'kugou.playback.authorization');
        const authorized = await transport.call('authorizePlayback', { hash: item.hash, authorization }, lease.signal); current();
        const permission = record(success(authorized).data, 'kugou.playback.permission');
        const proof = text(permission.auth, 'kugou.playback.proof');
        const openTime = integerValue(permission.open_time, 'kugou.playback.openTime');
        if (openTime === 0) throw new DomainError('invalid-response');
        const value = await transport.call('authorizedStream', { hash: item.hash, authorization: proof, openTime: String(openTime) }, lease.signal); current();
        return await parse(value, 'full');
      } catch (error: unknown) {
        current();
        // 未提供授权能力时保留原资源错误，不把“权限待确认”错误地改为资源下架。
        if (error instanceof DomainError && error.code === 'unavailable') throw previewError;
        throw error;
      }
    } catch (error: unknown) {
      if (resolution === this.#resolution && this.#sessions.isCurrent(lease)) {
        if (error instanceof DomainError && ['permission-denied', 'unavailable'].includes(error.code)) this.#trackAccess(id, 'unavailable');
        this.#operationError(lease, error);
      }
      throw error;
    }
  }
}
