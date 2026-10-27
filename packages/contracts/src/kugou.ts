import { parseAppError, type AppError } from './errors.ts';
import { choice, ContractValidationError, nonNegativeInteger, record, text } from './validation.ts';
import { initialKugouCatalog, parseKugouCatalog, parseKugouCatalogRequest, type KugouCatalog, type KugouCatalogRequest } from './kugou-catalog.ts';
import { parseKugouArtworkRequest, type KugouArtworkRequest } from './kugou-artwork.ts';

export const kugouTrackPageSize = 300;

export const kugouChannels = {
  getState: 'starsmusic:kugou:get-state', startLogin: 'starsmusic:kugou:start-login',
  cancelLogin: 'starsmusic:kugou:cancel-login', logout: 'starsmusic:kugou:logout',
  loadPlaylists: 'starsmusic:kugou:load-playlists', loadPlaylist: 'starsmusic:kugou:load-playlist',
  browse: 'starsmusic:kugou:browse', getArtwork: 'starsmusic:kugou:get-artwork', playPlaylist: 'starsmusic:kugou:play-playlist',
  enqueueNext: 'starsmusic:kugou:enqueue-next', playTrack: 'starsmusic:kugou:play-track', stateChanged: 'starsmusic:kugou:state-changed',
} as const;
export interface KugouPlaylist { readonly id: string; readonly name: string; readonly trackCount: number }
export interface KugouTrack { readonly id: string; readonly name: string; readonly artists: readonly string[]; readonly durationMs: number }
export const kugouLoginDiagnostics = ['authorization-userid', 'authorization-token', 'account-request', 'profile-userid', 'profile-mismatch', 'profile-nickname'] as const;
export type KugouLoginDiagnostic = typeof kugouLoginDiagnostics[number];
export interface KugouSnapshot {
  readonly revision: number;
  readonly generation: number;
  readonly status: 'signed-out' | 'loading-qr' | 'waiting-scan' | 'awaiting-confirmation' | 'verifying' | 'connected' | 'expired' | 'cancelled' | 'failed';
  readonly account?: { readonly id: string; readonly nickname: string };
  readonly qrImage?: string;
  readonly expiresAt?: number;
  readonly playlists: readonly KugouPlaylist[];
  readonly playlistsMore: boolean;
  readonly tracks: readonly KugouTrack[];
  readonly playlistId?: string;
  readonly tracksMore: boolean;
  readonly nextTrackOffset: number;
  readonly busy: boolean;
  readonly error?: AppError;
  readonly loginDiagnostic?: KugouLoginDiagnostic;
  readonly catalog: KugouCatalog;
}
export interface KugouApi {
  getState(): Promise<KugouSnapshot>;
  startLogin(): Promise<KugouSnapshot>;
  cancelLogin(): Promise<KugouSnapshot>;
  logout(): Promise<KugouSnapshot>;
  loadPlaylists(): Promise<KugouSnapshot>;
  loadPlaylist(id: string, offset: number): Promise<KugouSnapshot>;
  playTrack(id: string): Promise<void>;
  enqueueNext(id: string): Promise<void>;
  browse(request: KugouCatalogRequest): Promise<KugouSnapshot>;
  getArtwork(request: KugouArtworkRequest): Promise<string | null>;
  playPlaylist(id: string, source: 'public' | 'owned'): Promise<void>;
  onStateChanged(listener: (state: KugouSnapshot) => void): () => void;
}
export function kugouId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new ContractValidationError('kugou.id');
  return value;
}
export function parseKugouSnapshot(value: unknown): KugouSnapshot {
  const input = record(value, 'kugou');
  const status = choice(input.status, ['signed-out', 'loading-qr', 'waiting-scan', 'awaiting-confirmation', 'verifying', 'connected', 'expired', 'cancelled', 'failed'], 'kugou.status');
  if (!Array.isArray(input.playlists) || !Array.isArray(input.tracks)
    || typeof input.busy !== 'boolean' || typeof input.playlistsMore !== 'boolean' || typeof input.tracksMore !== 'boolean') {
    throw new ContractValidationError('kugou.lists');
  }
  let account: KugouSnapshot['account'];
  if (status === 'connected') {
    const raw = record(input.account, 'kugou.account');
    account = Object.freeze({ id: kugouId(raw.id), nickname: text(raw.nickname, 'kugou.nickname') });
  }
  const playlists = status === 'connected' ? input.playlists.map((value: unknown) => {
    const item = record(value, 'kugou.playlist');
    return Object.freeze({ id: kugouId(item.id), name: text(item.name, 'kugou.playlist.name'), trackCount: nonNegativeInteger(item.trackCount, 'kugou.trackCount') });
  }) : [];
  const tracks = status === 'connected' ? input.tracks.map((value: unknown) => {
    const item = record(value, 'kugou.track');
    if (!Array.isArray(item.artists)) throw new ContractValidationError('kugou.artists');
    return Object.freeze({ id: kugouId(item.id), name: text(item.name, 'kugou.track.name'), artists: Object.freeze(item.artists.map((artist: unknown) => text(artist, 'kugou.artist'))), durationMs: nonNegativeInteger(item.durationMs, 'kugou.duration') });
  }) : [];
  const qrAllowed = status === 'waiting-scan' || status === 'awaiting-confirmation';
  if (qrAllowed && (typeof input.qrImage !== 'string' || input.qrImage.length > 500_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(input.qrImage))) {
    throw new ContractValidationError('kugou.qrImage');
  }
  return Object.freeze({
    revision: nonNegativeInteger(input.revision, 'kugou.revision'), generation: nonNegativeInteger(input.generation, 'kugou.generation'), status,
    ...(account ? { account } : {}),
    ...(qrAllowed ? { qrImage: input.qrImage as string, expiresAt: nonNegativeInteger(input.expiresAt, 'kugou.expiresAt') } : {}),
    playlists: Object.freeze(playlists), tracks: Object.freeze(tracks),
    playlistsMore: status === 'connected' && input.playlistsMore, tracksMore: status === 'connected' && input.tracksMore,
    nextTrackOffset: status === 'connected' ? nonNegativeInteger(input.nextTrackOffset, 'kugou.nextTrackOffset') : 0,
    ...(status === 'connected' && input.playlistId !== undefined ? { playlistId: kugouId(input.playlistId) } : {}),
    busy: input.busy,
    catalog: input.catalog === undefined ? initialKugouCatalog() : parseKugouCatalog(input.catalog),
    ...(status === 'failed' && input.loginDiagnostic !== undefined ? { loginDiagnostic: choice(input.loginDiagnostic, kugouLoginDiagnostics, 'kugou.loginDiagnostic') } : {}),
    ...(input.error === undefined ? {} : { error: parseAppError(input.error) }),
  });
}
export function initialKugouSnapshot(): KugouSnapshot {
  return parseKugouSnapshot({ revision: 0, generation: 0, status: 'signed-out', playlists: [], tracks: [], playlistsMore: false, tracksMore: false, nextTrackOffset: 0, busy: false });
}
export function parseKugouArguments(channel: string, args: readonly unknown[]): { id?: string; offset?: number; source?: 'public' | 'owned'; catalog?: KugouCatalogRequest; artwork?: KugouArtworkRequest } {
  if (channel === kugouChannels.browse && args.length === 1) return { catalog: parseKugouCatalogRequest(args[0]) };
  if (channel === kugouChannels.getArtwork && args.length === 1) return { artwork: parseKugouArtworkRequest(args[0]) };
  if (channel === kugouChannels.playPlaylist && args.length === 2) return { id: kugouId(args[0]), source: choice(args[1], ['public', 'owned'], 'kugou.playlist.source') };
  if ((channel === kugouChannels.playTrack || channel === kugouChannels.enqueueNext) && args.length === 1) return { id: kugouId(args[0]) };
  if (channel === kugouChannels.loadPlaylist && args.length === 2) {
    const offset = nonNegativeInteger(args[1], 'kugou.offset');
    if (offset > 100000 || offset % kugouTrackPageSize !== 0) throw new ContractValidationError('kugou.offset');
    return { id: kugouId(args[0]), offset };
  }
  const empty: readonly string[] = [kugouChannels.getState, kugouChannels.startLogin, kugouChannels.cancelLogin, kugouChannels.logout, kugouChannels.loadPlaylists];
  if (empty.includes(channel) && args.length === 0) return {};
  throw new ContractValidationError('kugou.command');
}
