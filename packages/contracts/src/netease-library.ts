import { catalogId } from './netease-catalog.ts';
import { parseAppError, type AppError } from './errors.ts';
import { choice, ContractValidationError, record } from './validation.ts';
export type NeteaseMutation =
  | { kind: 'like'; id: string; liked: boolean }
  | { kind: 'playlist-track'; playlistId: string; trackId: string; operation: 'add' | 'del' }
  | { kind: 'subscribe'; id: string; subscribed: boolean };
export function parseNeteaseMutation(value: unknown): NeteaseMutation {
  const raw = record(value, 'netease.mutation');
  const kind = choice(raw.kind, ['like', 'playlist-track', 'subscribe'], 'netease.mutation.kind');
  const keys = kind === 'like' ? ['kind', 'id', 'liked'] : kind === 'subscribe' ? ['kind', 'id', 'subscribed'] : ['kind', 'playlistId', 'trackId', 'operation'];
  if (Object.keys(raw).some(key => !keys.includes(key))) throw new ContractValidationError('netease.mutation.fields');
  if (kind === 'playlist-track') return { kind, playlistId: catalogId(raw.playlistId), trackId: catalogId(raw.trackId), operation: choice(raw.operation, ['add', 'del'], 'netease.mutation.operation') };
  if (typeof raw[kind === 'like' ? 'liked' : 'subscribed'] !== 'boolean') throw new ContractValidationError('netease.mutation.toggle');
  return kind === 'like' ? { kind, id: catalogId(raw.id), liked: raw.liked as boolean } : { kind, id: catalogId(raw.id), subscribed: raw.subscribed as boolean };
}
export interface NeteaseLibrary {
  readonly likesStatus: 'idle' | 'loading' | 'ready' | 'error';
  readonly likedIds: readonly string[];
  readonly busy: boolean;
  readonly unconfirmed?: boolean;
  readonly error?: AppError | undefined;
}
export function parseNeteaseLibrary(value: unknown): NeteaseLibrary {
  const raw = record(value, 'netease.library');
  if ((raw.unconfirmed !== undefined && typeof raw.unconfirmed !== 'boolean') || !Array.isArray(raw.likedIds) || raw.likedIds.length > 50000 || typeof raw.busy !== 'boolean') throw new ContractValidationError('netease.library');
  return Object.freeze({ likesStatus: choice(raw.likesStatus, ['idle', 'loading', 'ready', 'error'], 'netease.library.likesStatus'), likedIds: Object.freeze([...new Set(raw.likedIds.map(catalogId))]), busy: raw.busy, ...(raw.unconfirmed === undefined ? {} : { unconfirmed: raw.unconfirmed === true }), ...(raw.error === undefined ? {} : { error: parseAppError(raw.error) }) });
}
export const initialNeteaseLibrary = (): NeteaseLibrary => parseNeteaseLibrary({ likesStatus: 'idle', likedIds: [], busy: false });
