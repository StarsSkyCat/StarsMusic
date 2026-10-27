import { initialNeteaseMembership, parseNeteaseMembership, parseNeteaseTrackRights, type NeteaseMembership, type NeteaseTrackRights } from './netease-rights.ts';
import { parseNeteaseArtworkRequest, type NeteaseArtworkRequest } from './netease-artwork.ts';
import { parseAppError, type AppError } from './errors.ts';
import { choice, ContractValidationError, nonNegativeInteger, record, text } from './validation.ts';
import { initialCatalog, parseCatalog, parseCatalogRequest, type CatalogRequest, type NeteaseCatalog } from './netease-catalog.ts';

export const neteaseChannels = {
  getState: 'starsmusic:netease:get-state', startLogin: 'starsmusic:netease:start-login',
  cancelLogin: 'starsmusic:netease:cancel-login', logout: 'starsmusic:netease:logout',
  loadPlaylists: 'starsmusic:netease:load-playlists', loadPlaylist: 'starsmusic:netease:load-playlist',
  refreshMembership: 'starsmusic:netease:refresh-membership',
  browse: 'starsmusic:netease:browse', getArtwork: 'starsmusic:netease:get-artwork',
  enqueueNext: 'starsmusic:netease:enqueue-next', playTrack: 'starsmusic:netease:play-track', stateChanged: 'starsmusic:netease:state-changed',
} as const;
export interface NeteasePlaylist { readonly id: string; readonly name: string; readonly trackCount: number }
export interface NeteaseTrack { readonly id: string; readonly name: string; readonly artists: readonly string[]; readonly durationMs: number; readonly rights?: NeteaseTrackRights }
export interface NeteaseSnapshot {
  readonly revision: number;
  readonly generation: number;
  readonly status: 'signed-out' | 'loading-qr' | 'waiting-scan' | 'awaiting-confirmation' | 'verifying' | 'connected' | 'expired' | 'cancelled' | 'failed';
  readonly account?: { readonly id: string; readonly nickname: string };
  readonly qrImage?: string;
  readonly expiresAt?: number;
  readonly playlists: readonly NeteasePlaylist[];
  readonly playlistsMore: boolean;
  readonly tracks: readonly NeteaseTrack[];
  readonly playlistId?: string;
  readonly tracksMore: boolean;
  readonly nextTrackOffset: number;
  readonly busy: boolean;
  readonly error?: AppError;
  readonly catalog: NeteaseCatalog;
  readonly membership: NeteaseMembership;
}
export interface NeteaseApi {
  getState(): Promise<NeteaseSnapshot>;
  refreshMembership(): Promise<NeteaseSnapshot>;
  startLogin(): Promise<NeteaseSnapshot>;
  cancelLogin(): Promise<NeteaseSnapshot>;
  logout(): Promise<NeteaseSnapshot>;
  loadPlaylists(): Promise<NeteaseSnapshot>;
  loadPlaylist(id: string, offset: number): Promise<NeteaseSnapshot>;
  browse(request: CatalogRequest): Promise<NeteaseSnapshot>;
  getArtwork(request: NeteaseArtworkRequest): Promise<string | null>;
  playTrack(id: string): Promise<void>;
  enqueueNext(id: string): Promise<void>;
  onStateChanged(listener: (state: NeteaseSnapshot) => void): () => void;
}
export function neteaseId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,30}$/.test(value)) throw new ContractValidationError('netease.id');
  return value;
}
export function parseNeteaseSnapshot(value: unknown): NeteaseSnapshot {
  const input = record(value, 'netease');
  const status = choice(input.status, ['signed-out', 'loading-qr', 'waiting-scan', 'awaiting-confirmation', 'verifying', 'connected', 'expired', 'cancelled', 'failed'], 'netease.status');
  if (!Array.isArray(input.playlists) || !Array.isArray(input.tracks)
    || typeof input.busy !== 'boolean' || typeof input.playlistsMore !== 'boolean' || typeof input.tracksMore !== 'boolean') {
    throw new ContractValidationError('netease.lists');
  }
  let account: NeteaseSnapshot['account'];
  if (status === 'connected') {
    const raw = record(input.account, 'netease.account');
    account = Object.freeze({ id: neteaseId(raw.id), nickname: text(raw.nickname, 'netease.nickname') });
  }
  const playlists = status === 'connected' ? input.playlists.map((value: unknown) => {
    const item = record(value, 'netease.playlist');
    return Object.freeze({ id: neteaseId(item.id), name: text(item.name, 'netease.playlist.name'), trackCount: nonNegativeInteger(item.trackCount, 'netease.trackCount') });
  }) : [];
  const tracks = status === 'connected' ? input.tracks.map((value: unknown) => {
    const item = record(value, 'netease.track');
    if (!Array.isArray(item.artists)) throw new ContractValidationError('netease.artists');
    return Object.freeze({ id: neteaseId(item.id), name: text(item.name, 'netease.track.name'), artists: Object.freeze(item.artists.map((artist: unknown) => text(artist, 'netease.artist'))), durationMs: nonNegativeInteger(item.durationMs, 'netease.duration'), ...(item.rights === undefined ? {} : { rights: parseNeteaseTrackRights(item.rights) }) });
  }) : [];
  const qrAllowed = status === 'waiting-scan' || status === 'awaiting-confirmation';
  if (qrAllowed && (typeof input.qrImage !== 'string' || input.qrImage.length > 500_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(input.qrImage))) {
    throw new ContractValidationError('netease.qrImage');
  }
  return Object.freeze({
    revision: nonNegativeInteger(input.revision, 'netease.revision'), generation: nonNegativeInteger(input.generation, 'netease.generation'), status,
    ...(account ? { account } : {}),
    ...(qrAllowed ? { qrImage: input.qrImage as string, expiresAt: nonNegativeInteger(input.expiresAt, 'netease.expiresAt') } : {}),
    playlists: Object.freeze(playlists), tracks: Object.freeze(tracks),
    playlistsMore: status === 'connected' && input.playlistsMore, tracksMore: status === 'connected' && input.tracksMore,
    nextTrackOffset: status === 'connected' ? nonNegativeInteger(input.nextTrackOffset, 'netease.nextTrackOffset') : 0,
    ...(status === 'connected' && input.playlistId !== undefined ? { playlistId: neteaseId(input.playlistId) } : {}),
    busy: input.busy,
    membership: status === 'connected' && input.membership !== undefined ? parseNeteaseMembership(input.membership) : initialNeteaseMembership(),
    catalog: input.catalog === undefined ? initialCatalog() : parseCatalog(input.catalog),
    ...(input.error === undefined ? {} : { error: parseAppError(input.error) }),
  });
}
export function initialNeteaseSnapshot(): NeteaseSnapshot {
  return parseNeteaseSnapshot({ revision: 0, generation: 0, status: 'signed-out', playlists: [], tracks: [], playlistsMore: false, tracksMore: false, nextTrackOffset: 0, busy: false });
}
export function parseNeteaseArguments(channel: string, args: readonly unknown[]): { id?: string; offset?: number; catalog?: CatalogRequest; artwork?: NeteaseArtworkRequest } {
  if (channel === neteaseChannels.getArtwork && args.length === 1) return { artwork: parseNeteaseArtworkRequest(args[0]) };
  if (channel === neteaseChannels.browse && args.length === 1) return { catalog: parseCatalogRequest(args[0]) };
  if ((channel === neteaseChannels.playTrack || channel === neteaseChannels.enqueueNext) && args.length === 1) return { id: neteaseId(args[0]) };
  if (channel === neteaseChannels.loadPlaylist && args.length === 2) {
    const offset = nonNegativeInteger(args[1], 'netease.offset');
    if (offset > 100000 || offset % 50 !== 0) throw new ContractValidationError('netease.offset');
    return { id: neteaseId(args[0]), offset };
  }
  const empty: readonly string[] = [neteaseChannels.getState, neteaseChannels.startLogin, neteaseChannels.cancelLogin, neteaseChannels.logout, neteaseChannels.loadPlaylists, neteaseChannels.refreshMembership];
  if (empty.includes(channel) && args.length === 0) return {};
  throw new ContractValidationError('netease.command');
}
