import { parseAppError, type AppError } from './errors.ts';
import { choice, ContractValidationError, nonNegativeInteger, positiveNumber, record, text } from './validation.ts';

export const providerIds = ['netease', 'kugou', 'local'] as const;
export type ProviderId = typeof providerIds[number];
export type OnlineProviderId = Exclude<ProviderId, 'local'>;

export interface TrackRef {
  readonly provider: ProviderId;
  readonly id: string;
  readonly variant?: string;
}

export type OnlineProviderContext =
  | { readonly provider: 'netease'; readonly clientChannel: 'netease-app' | 'netease-web'; readonly accountId?: string }
  | { readonly provider: 'kugou'; readonly clientChannel: 'kugou-app' | 'kugou-web'; readonly accountId?: string };
export type ProviderContext = OnlineProviderContext | { readonly provider: 'local' };

export function parseTrackRef(value: unknown): TrackRef {
  const input = record(value, 'track');
  return Object.freeze({
    provider: choice(input.provider, providerIds, 'track.provider'),
    id: text(input.id, 'track.id'),
    ...(input.variant === undefined ? {} : { variant: text(input.variant, 'track.variant') }),
  });
}

export function parseProviderContext(value: unknown): ProviderContext {
  const input = record(value, 'context');
  const provider = choice(input.provider, providerIds, 'context.provider');
  if (provider === 'local') {
    if (input.accountId !== undefined || input.clientChannel !== undefined) {
      throw new ContractValidationError('context.local');
    }
    return Object.freeze({ provider });
  }
  const account = input.accountId === undefined ? {} : { accountId: text(input.accountId, 'context.accountId') };
  if (provider === 'netease') {
    return Object.freeze({ provider, clientChannel: choice(input.clientChannel, ['netease-app', 'netease-web'], 'context.clientChannel'), ...account });
  }
  return Object.freeze({ provider, clientChannel: choice(input.clientChannel, ['kugou-app', 'kugou-web'], 'context.clientChannel'), ...account });
}

export function parseOnlineContext(value: unknown): OnlineProviderContext {
  const context = parseProviderContext(value);
  if (context.provider === 'local') throw new ContractValidationError('context.provider');
  return context;
}

export function contextKey(value: ProviderContext): string {
  const context = parseProviderContext(value);
  // JSON 元组避免分隔符碰撞，并区分游客与名为 "null" 的账号。
  return JSON.stringify(context.provider === 'local'
    ? ['local', null, null]
    : [context.provider, context.accountId ?? null, context.clientChannel]);
}

export type LoginState =
  | { readonly status: 'signed-out' | 'expired' | 'cancelled' }
  | { readonly status: 'waiting-scan' | 'waiting-authorization' | 'awaiting-confirmation' | 'verifying'; readonly challengeId: string; readonly expiresAt?: number }
  | { readonly status: 'connected'; readonly identityVerified: true; readonly lastVerifiedAt: number; readonly expiresAt?: number }
  | { readonly status: 'failed'; readonly error: AppError };

export interface SessionStatus {
  readonly context: OnlineProviderContext;
  readonly generation: number;
  readonly login: LoginState;
}

export function parseLoginState(value: unknown): LoginState {
  const input = record(value, 'login');
  const status = choice(input.status, [
    'signed-out', 'expired', 'cancelled', 'waiting-scan', 'waiting-authorization',
    'awaiting-confirmation', 'verifying', 'connected', 'failed',
  ], 'login.status');
  if (status === 'signed-out' || status === 'expired' || status === 'cancelled') return Object.freeze({ status });
  if (status === 'failed') return Object.freeze({ status, error: parseAppError(input.error) });
  const expiry = input.expiresAt === undefined ? {} : { expiresAt: nonNegativeInteger(input.expiresAt, 'login.expiresAt') };
  if (status === 'connected') {
    if (input.identityVerified !== true) throw new ContractValidationError('login.identityVerified');
    const lastVerifiedAt = nonNegativeInteger(input.lastVerifiedAt, 'login.lastVerifiedAt');
    if (expiry.expiresAt !== undefined && expiry.expiresAt <= lastVerifiedAt) {
      throw new ContractValidationError('login.expiresAt');
    }
    return Object.freeze({ status, identityVerified: true, lastVerifiedAt, ...expiry });
  }
  return Object.freeze({ status, challengeId: text(input.challengeId, 'login.challengeId'), ...expiry });
}

export function parseSessionStatus(value: unknown): SessionStatus {
  const input = record(value, 'session');
  const context = parseOnlineContext(input.context);
  const login = parseLoginState(input.login);
  if ((login.status === 'connected') !== (context.accountId !== undefined)) {
    throw new ContractValidationError('session.accountId');
  }
  return Object.freeze({ context, generation: nonNegativeInteger(input.generation, 'session.generation'), login });
}

export interface StreamQuality {
  readonly level: 'unknown' | 'standard' | 'high' | 'lossless' | 'hi-res';
  readonly codec?: string;
  readonly bitrateKbps?: number;
  readonly sampleRateHz?: number;
}

// 后台专用，不能通过 UI IPC、日志、数据库或页面存储传输此结构。
export interface StreamResolution {
  readonly track: TrackRef;
  readonly source:
    | { readonly kind: 'remote'; readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly expiresAt?: number }
    | { readonly kind: 'local'; readonly fileId: string };
  readonly quality: StreamQuality;
  readonly access: { readonly kind: 'full' } | { readonly kind: 'preview'; readonly startMs: number; readonly durationMs: number };
}

export function parseStreamResolution(value: unknown): StreamResolution {
  const input = record(value, 'stream');
  const track = parseTrackRef(input.track);
  const rawSource = record(input.source, 'stream.source');
  let source: StreamResolution['source'];
  const kind = choice(rawSource.kind, ['local', 'remote'], 'stream.source.kind');
  if (kind === 'local') {
    const fileId = text(rawSource.fileId, 'stream.source.fileId');
    if (track.provider !== 'local' || fileId !== track.id) throw new ContractValidationError('stream.source.fileId');
    source = Object.freeze({ kind, fileId });
  } else {
    if (track.provider === 'local') throw new ContractValidationError('stream.track.provider');
    const url = text(rawSource.url, 'stream.source.url');
    if (/[\u0000-\u0020\u007f]/.test(url)) throw new ContractValidationError('stream.source.url');
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new ContractValidationError('stream.source.url'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
      throw new ContractValidationError('stream.source.url');
    }
    const rawHeaders = record(rawSource.headers, 'stream.source.headers');
    const headers: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [name, value] of Object.entries(rawHeaders)) {
      const lowerName = name.toLowerCase();
      if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || typeof value !== 'string'
        || /[\u0000-\u0008\u000a-\u001f\u007f]/.test(value) || lowerName in headers
        || ['host', 'connection', 'content-length', 'transfer-encoding', 'proxy-authorization'].includes(lowerName)) {
        throw new ContractValidationError('stream.source.headers');
      }
      headers[lowerName] = value;
    }
    source = Object.freeze({
      kind, url, headers: Object.freeze(headers),
      ...(rawSource.expiresAt === undefined ? {} : { expiresAt: nonNegativeInteger(rawSource.expiresAt, 'stream.source.expiresAt') }),
    });
  }
  const rawQuality = record(input.quality, 'stream.quality');
  const quality: StreamQuality = Object.freeze({
    level: choice(rawQuality.level, ['unknown', 'standard', 'high', 'lossless', 'hi-res'], 'stream.quality.level'),
    ...(rawQuality.codec === undefined ? {} : { codec: text(rawQuality.codec, 'stream.quality.codec') }),
    ...(rawQuality.bitrateKbps === undefined ? {} : { bitrateKbps: positiveNumber(rawQuality.bitrateKbps, 'stream.quality.bitrateKbps') }),
    ...(rawQuality.sampleRateHz === undefined ? {} : { sampleRateHz: positiveNumber(rawQuality.sampleRateHz, 'stream.quality.sampleRateHz') }),
  });
  const rawAccess = record(input.access, 'stream.access');
  const accessKind = choice(rawAccess.kind, ['full', 'preview'], 'stream.access.kind');
  const access: StreamResolution['access'] = accessKind === 'full' ? Object.freeze({ kind: accessKind }) : Object.freeze({
    kind: accessKind,
    startMs: nonNegativeInteger(rawAccess.startMs, 'stream.access.startMs'),
    durationMs: positiveNumber(rawAccess.durationMs, 'stream.access.durationMs'),
  });
  return Object.freeze({ track, source, quality, access });
}
