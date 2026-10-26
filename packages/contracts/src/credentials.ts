import { parseAppError, type AppError } from './errors.ts';
import { choice, ContractValidationError, nonNegativeInteger, record, text } from './validation.ts';

export const credentialProviderIds = ['netease', 'kugou'] as const;
export type CredentialProvider = typeof credentialProviderIds[number];

export const credentialChannels = {
  getStatus: 'starsmusic:credentials:get-status',
  setRemember: 'starsmusic:credentials:set-remember',
  clear: 'starsmusic:credentials:clear',
  changed: 'starsmusic:credentials:changed',
} as const;

export interface CredentialStatus {
  readonly available: boolean;
  readonly backend: string;
  readonly remembered: boolean;
  readonly locked: boolean;
  readonly savedProviders: readonly CredentialProvider[];
  readonly error?: AppError;
}
export interface CredentialsApi {
  getStatus(): Promise<CredentialStatus>;
  setRemember(value: boolean): Promise<CredentialStatus>;
  clear(): Promise<CredentialStatus>;
  onChanged(listener: (status: CredentialStatus) => void): () => void;
}
export function parseCredentialArguments(channel: string, args: readonly unknown[]): boolean | undefined {
  if (channel === credentialChannels.setRemember) {
    if (args.length !== 1 || typeof args[0] !== 'boolean') throw new ContractValidationError('credential.remember');
    return args[0];
  }
  const empty: readonly string[] = [credentialChannels.getStatus, credentialChannels.clear];
  if (empty.includes(channel) && args.length === 0) return undefined;
  throw new ContractValidationError('credential.command');
}

export interface NeteaseCredentialBundle {
  readonly provider: 'netease';
  readonly version: 1;
  readonly clientChannel: 'netease-app';
  readonly accountId: string;
  readonly nickname: string;
  readonly cookies: Readonly<Record<string, string>>;
  readonly deviceId: string;
  readonly nuid: string;
  readonly savedAt: number;
}

export interface KugouCredentialBundle {
  readonly provider: 'kugou';
  readonly version: 1;
  readonly clientChannel: 'kugou-app';
  readonly accountId: string;
  readonly nickname: string;
  readonly userid: string;
  readonly token: string;
  readonly dfid: string;
  readonly guid: string;
  readonly savedAt: number;
}

export type CredentialBundle = NeteaseCredentialBundle | KugouCredentialBundle;

function noControl(value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new ContractValidationError('credential.value');
  return value;
}
function boundedText(value: unknown, field: string, max: number): string {
  const result = noControl(text(value, field));
  if (result.length > max) throw new ContractValidationError(field);
  return result;
}
function digits(value: unknown, field: string, max = 30): string {
  const result = text(value, field);
  if (!/^\d{1,30}$/.test(result) || result.length > max) throw new ContractValidationError(field);
  return result;
}
function parseNeteaseBundle(input: Record<string, unknown>): NeteaseCredentialBundle {
  if (input.version !== 1 || input.clientChannel !== 'netease-app') throw new ContractValidationError('credential.netease');
  const rawCookies = record(input.cookies, 'credential.cookies');
  const allowed = ['MUSIC_U', '__csrf', 'NMTID', 'MUSIC_A'];
  const cookies: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawCookies)) {
    if (!allowed.includes(name) || typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new ContractValidationError('credential.cookies');
    }
    if (value.length > 0) cookies[name] = value;
  }
  if (!cookies.MUSIC_U) throw new ContractValidationError('credential.cookies');
  const deviceId = boundedText(input.deviceId, 'credential.deviceId', 128);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(deviceId)) throw new ContractValidationError('credential.deviceId');
  const nuid = boundedText(input.nuid, 'credential.nuid', 32);
  if (!/^[a-f0-9]{32}$/.test(nuid)) throw new ContractValidationError('credential.nuid');
  return Object.freeze({
    provider: 'netease', version: 1, clientChannel: 'netease-app', accountId: digits(input.accountId, 'credential.accountId'),
    nickname: boundedText(input.nickname, 'credential.nickname', 200), cookies: Object.freeze(cookies), deviceId, nuid,
    savedAt: nonNegativeInteger(input.savedAt, 'credential.savedAt'),
  });
}
function parseKugouBundle(input: Record<string, unknown>): KugouCredentialBundle {
  if (input.version !== 1 || input.clientChannel !== 'kugou-app') throw new ContractValidationError('credential.kugou');
  const accountId = digits(input.accountId, 'credential.accountId');
  const userid = digits(input.userid, 'credential.userid');
  if (accountId !== userid) throw new ContractValidationError('credential.userid');
  const token = boundedText(input.token, 'credential.token', 96);
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(token)) throw new ContractValidationError('credential.token');
  const dfid = boundedText(input.dfid, 'credential.dfid', 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(dfid)) throw new ContractValidationError('credential.dfid');
  const guid = boundedText(input.guid, 'credential.guid', 64);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(guid)) throw new ContractValidationError('credential.guid');
  return Object.freeze({
    provider: 'kugou', version: 1, clientChannel: 'kugou-app', accountId, nickname: boundedText(input.nickname, 'credential.nickname', 200),
    userid, token, dfid, guid, savedAt: nonNegativeInteger(input.savedAt, 'credential.savedAt'),
  });
}
export function parseCredentialBundle(value: unknown): CredentialBundle {
  const input = record(value, 'credential');
  const provider = choice(input.provider, credentialProviderIds, 'credential.provider');
  return provider === 'netease' ? parseNeteaseBundle(input) : parseKugouBundle(input);
}
export function parseCredentialStatus(value: unknown): CredentialStatus {
  const input = record(value, 'credential.status');
  if (typeof input.available !== 'boolean' || typeof input.remembered !== 'boolean' || typeof input.locked !== 'boolean') {
    throw new ContractValidationError('credential.status.flags');
  }
  const backend = boundedText(input.backend, 'credential.status.backend', 64);
  if (!Array.isArray(input.savedProviders)) throw new ContractValidationError('credential.status.savedProviders');
  const savedProviders = [...new Set(input.savedProviders.map((provider: unknown) => choice(provider, credentialProviderIds, 'credential.provider')))];
  return Object.freeze({
    available: input.available, backend, remembered: input.remembered, locked: input.locked,
    savedProviders: Object.freeze(savedProviders),
    ...(input.error === undefined ? {} : { error: parseAppError(input.error) }),
  });
}
