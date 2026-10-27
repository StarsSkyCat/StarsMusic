import { randomBytes, randomUUID } from 'node:crypto';
import { DomainError } from '../../../contracts/src/errors.ts';
import { record } from '../../../contracts/src/validation.ts';
import { encodeEapi, encodeWeapi } from './crypto.ts';

export const neteaseProtocolBaseline = 'api-enhanced@4.41.1/2db6684453297ee86dec0492842f2320b08182d9';
export const endpoints = {
  qrKey: ['/api/login/qrcode/unikey', 'eapi'], qrPoll: ['/api/login/qrcode/client/login', 'eapi'],
  account: ['/api/nuser/account/get', 'weapi'], playlists: ['/api/user/playlist', 'weapi'],
  playlist: ['/api/v6/playlist/detail', 'eapi'], songs: ['/api/v3/song/detail', 'weapi'],
  stream: ['/api/song/enhance/player/url', 'eapi'], lyric: ['/api/song/lyric', 'weapi'],
  search: ['/api/cloudsearch/pc', 'weapi'], publicPlaylists: ['/api/playlist/list', 'weapi'],
  toplists: ['/api/toplist', 'weapi'], vip: ['/api/music-vip-membership/front/vip/info', 'weapi'],
} as const;
export type NeteaseEndpoint = keyof typeof endpoints;
export interface NeteaseTransportSession {
  readonly cookies: Readonly<Record<string, string>>;
  readonly deviceId: string;
  readonly nuid: string;
}
export interface NeteaseTransport {
  call(endpoint: NeteaseEndpoint, data: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  hasIdentity(): boolean;
  exportSession(): NeteaseTransportSession | undefined;
  restoreSession(session: NeteaseTransportSession): void;
  clear(): void;
}

export { parseApiJson } from '../api-json.ts';
import { parseApiJson } from '../api-json.ts';

export class DirectNeteaseTransport implements NeteaseTransport {
  #cookies = new Map<string, string>();
  #deviceId: string = randomUUID();
  #nuid = randomBytes(16).toString('hex');
  hasIdentity(): boolean { return this.#cookies.has('MUSIC_U'); }
  exportSession(): NeteaseTransportSession | undefined {
    if (!this.hasIdentity()) return undefined;
    return Object.freeze({ cookies: Object.freeze(Object.fromEntries(this.#cookies)), deviceId: this.#deviceId, nuid: this.#nuid });
  }
  restoreSession(session: NeteaseTransportSession): void {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(session.deviceId) || !/^[a-f0-9]{32}$/.test(session.nuid)) throw new DomainError('invalid-response');
    const cookies = Object.entries(session.cookies);
    if (!cookies.some(([name, value]) => name === 'MUSIC_U' && value.length > 0)) throw new DomainError('invalid-response');
    this.#cookies = new Map(cookies);
    this.#deviceId = session.deviceId;
    this.#nuid = session.nuid;
  }
  clear(): void { this.#cookies.clear(); }

  async call(endpoint: NeteaseEndpoint, data: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const [uri, protocol] = endpoints[endpoint];
    const cookie = Object.fromEntries(this.#cookies);
    const base = {
      os: 'pc', appver: '3.1.17.204416', channel: 'netease', osver: 'Microsoft-Windows-10-Professional-build-19045-64bit',
      deviceId: this.#deviceId, __csrf: cookie.__csrf ?? '', requestId: `${Date.now()}_${randomBytes(3).toString('hex')}`,
      ...cookie,
    };
    const payload = protocol === 'weapi'
      ? encodeWeapi({ ...data, csrf_token: cookie.__csrf ?? '' })
      : encodeEapi(uri, { ...data, e_r: false, header: base });
    const target = protocol === 'weapi' ? `https://music.163.com/weapi/${uri.slice(5)}` : `https://interfacepc.music.163.com/eapi/${uri.slice(5)}`;
    const combined = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
    try {
      const response = await fetch(target, {
        method: 'POST', redirect: 'error', signal: combined,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/',
          'User-Agent': 'Mozilla/5.0 NeteaseMusicDesktop/3.1.17.204416',
          Cookie: Object.entries({ ...base, _ntes_nuid: this.#nuid }).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('; '),
        }, body: new URLSearchParams(payload).toString(),
      });
      if (response.status === 429) throw new DomainError('rate-limited');
      if (!response.ok) throw new DomainError('network');
      const reader = response.body?.getReader();
      if (!reader) throw new DomainError('invalid-response');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 8 * 1024 * 1024) throw new DomainError('invalid-response');
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      combined.throwIfAborted();
      const body = record(parseApiJson(Buffer.concat(chunks).toString('utf8')), 'netease.response');
      for (const raw of response.headers.getSetCookie()) {
        const match = /^(MUSIC_U|__csrf|NMTID|MUSIC_A)=([^;\r\n]*)/.exec(raw);
        if (match?.[1] && match[2]) this.#cookies.set(match[1], decodeURIComponent(match[2]));
      }
      return body;
    } catch (error: unknown) {
      if (error instanceof DomainError) throw error;
      if (signal.aborted) throw new DomainError('cancelled');
      if (combined.aborted) throw new DomainError('timeout');
      throw new DomainError('network');
    }
  }
}
