import { createServer, type Server } from 'node:http';
import { request as requestHttps } from 'node:https';
import { lookup } from 'node:dns';
import { randomBytes } from 'node:crypto';
import { type Readable, pipeline } from 'node:stream';
import { isIP, type Socket } from 'node:net';
import { DomainError } from '../../contracts/src/errors.ts';

export function allowedMediaUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new DomainError('invalid-response'); }
  if (/[\u0000-\u0020\u007f]/.test(value) || url.protocol !== 'https:' || url.username || url.password
    || url.port || url.hash || !url.hostname.endsWith('.music.126.net')) throw new DomainError('invalid-response');
  return url;
}
export function publicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a = 0, b = 0, c = 0] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
}
export function allowedMediaAddress(address: string): boolean {
  if (publicIpv4(address)) return true;
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  // 常见本机 DNS 代理的 Fake-IP 池。连接仍必须验证原始官方 CDN 主机的 TLS 身份。
  // 不能把代理映射误判为平台下发了任意内网 URL；其他私网/环回/链路本地地址仍拒绝。
  return a === 198 && (b === 18 || b === 19);
}
interface Upstream {
  status: number;
  headers: Record<string, string | undefined>;
  stream: Readable;
}
export type FetchMedia = (url: URL, headers: Record<string, string>, signal: AbortSignal) => Promise<Upstream>;

const fetchMedia: FetchMedia = (url, headers, signal) => new Promise((resolve, reject) => {
  const request = requestHttps(url, {
    method: 'GET', headers, signal, family: 4,
    lookup(hostname, _options, callback) {
      lookup(hostname, { family: 4 }, (error, address) => {
        if (error || !allowedMediaAddress(address)) callback(new Error('media DNS rejected'), '', 4);
        else callback(null, address, 4);
      });
    },
  }, (response) => {
    request.setTimeout(0);
    const selected: Record<string, string | undefined> = {};
    for (const name of ['location', 'content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = response.headers[name];
      if (typeof value === 'string') selected[name] = value;
    }
    resolve({ status: response.statusCode ?? 502, headers: selected, stream: response });
  });
  request.setTimeout(10000, () => request.destroy(new Error('media timeout')));
  request.on('error', () => reject(new DomainError('network')));
  request.end();
});

// 仅向 mpv 提供不可猜的本机地址；CDN 凭据/签名 URL 从不进入页面或命令行。
export class MediaGateway {
  #server: Server;
  #abort = new AbortController();
  #sockets = new Set<Socket>();
  #closed = false;
  #url: string;
  #token = randomBytes(32).toString('base64url');
  #fetch: FetchMedia;
  #removeAbort: (() => void) | undefined;
  address = '';

  private constructor(url: string, fetcher: FetchMedia) {
    this.#url = allowedMediaUrl(url).href; this.#fetch = fetcher;
    this.#server = createServer((request, response) => {
      void (async () => {
        if (request.url !== `/${this.#token}`) { response.writeHead(404).end(); return; }
        if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
        const range = request.headers.range;
        if (range !== undefined && (typeof range !== 'string' || range.length > 80 || !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))) {
          response.writeHead(416).end(); return;
        }
        const aborted = new AbortController();
        response.once('close', () => aborted.abort());
        request.once('aborted', () => aborted.abort());
        const signal = AbortSignal.any([aborted.signal, this.#abort.signal]);
        let target = allowedMediaUrl(this.#url);
        for (let redirects = 0; redirects <= 3; redirects++) {
          const result = await this.#fetch(target, { Accept: 'audio/*', ...(range ? { Range: range } : {}) }, signal);
          if ([301, 302, 303, 307, 308].includes(result.status)) {
            result.stream.destroy();
            if (redirects === 3 || !result.headers.location) throw new DomainError('network');
            target = allowedMediaUrl(new URL(result.headers.location, target).href);
            continue;
          }
          if (![200, 206, 416].includes(result.status)) { result.stream.destroy(); throw new DomainError('unavailable'); }
          const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
          for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
            if (result.headers[key] !== undefined) headers[key] = result.headers[key]!;
          }
          response.writeHead(result.status, headers);
          if (request.method === 'HEAD') { result.stream.destroy(); response.end(); }
          else pipeline(result.stream, response, () => undefined);
          return;
        }
      })().catch(() => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
    });
    this.#server.on('connection', (socket) => { this.#sockets.add(socket); socket.once('close', () => this.#sockets.delete(socket)); });
  }
  static async open(url: string, signal: AbortSignal, fetcher: FetchMedia = fetchMedia): Promise<MediaGateway> {
    signal.throwIfAborted();
    const gateway = new MediaGateway(url, fetcher);
    await new Promise<void>((resolve, reject) => {
      gateway.#server.once('error', reject);
      gateway.#server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = gateway.#server.address();
    if (!address || typeof address === 'string') { await gateway.close(); throw new DomainError('internal'); }
    gateway.address = `http://127.0.0.1:${address.port}/${gateway.#token}`;
    const abort = () => { void gateway.close(); };
    signal.addEventListener('abort', abort, { once: true });
    gateway.#removeAbort = () => signal.removeEventListener('abort', abort);
    if (signal.aborted) { await gateway.close(); signal.throwIfAborted(); }
    return gateway;
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true; this.#removeAbort?.(); this.#abort.abort();
    for (const socket of this.#sockets) socket.destroy();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }
}
