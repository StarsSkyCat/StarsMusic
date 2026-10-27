import { request } from 'node:https';
import { lookup } from 'node:dns';
import type { OnlineProviderId } from '../../contracts/src/music.ts';
import { DomainError } from '../../contracts/src/errors.ts';

export function artworkUrl(value: unknown, provider: OnlineProviderId): URL {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value))
    throw new DomainError('invalid-response');
  let url: URL;
  try {
    url = new URL(value.replace(/\{size\}/g, '400'));
  } catch {
    throw new DomainError('invalid-response');
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  const hosts =
    provider === 'netease'
      ? ['p1.music.126.net', 'p2.music.126.net', 'p3.music.126.net', 'p4.music.126.net']
      : ['imge.kugou.com', 'imgessl.kugou.com', 'singerimg.kugou.com', 'c1.kgimg.com'];
  if (
    !hosts.includes(url.hostname) ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    throw new DomainError('invalid-response');
  return url;
}
export function artworkData(bytes: Buffer): string {
  const mime =
    bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'png'
      : bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? 'jpeg'
        : bytes.length >= 12 &&
            bytes.toString('ascii', 0, 4) === 'RIFF' &&
            bytes.toString('ascii', 8, 12) === 'WEBP'
          ? 'webp'
          : undefined;
  if (!mime || bytes.length > 550_000) throw new DomainError('invalid-response');
  return `data:image/${mime};base64,${bytes.toString('base64')}`;
}
export type LoadArtwork = (
  value: string,
  provider: OnlineProviderId,
  signal: AbortSignal,
) => Promise<string>;
export const loadArtwork: LoadArtwork = async (value, provider, signal) => {
  const url = artworkUrl(value, provider);
  const combined = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        signal: combined,
        family: 4,
        headers: { Accept: 'image/png,image/jpeg,image/webp' },
        lookup(hostname, _options, callback) {
          lookup(hostname, { family: 4 }, (error, address) => {
            const [a = 0, b = 0, c = 0] = address?.split('.').map(Number) ?? [];
            const blocked =
              a === 0 ||
              a === 10 ||
              a === 127 ||
              a >= 224 ||
              (a === 100 && b >= 64 && b <= 127) ||
              (a === 169 && b === 254) ||
              (a === 172 && b >= 16 && b <= 31) ||
              (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
              (a === 198 && b === 51 && c === 100) ||
              (a === 203 && b === 0 && c === 113);
            if (error || blocked) callback(new Error('artwork DNS rejected'), '', 4);
            else callback(null, address, 4);
          });
        },
      },
      (response) => {
        // 不携带 Cookie，也不跟随图片重定向到未经校验的地址。
        if (response.statusCode !== 200) {
          response.destroy();
          reject(new DomainError('unavailable'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 550_000) response.destroy(new DomainError('invalid-response'));
          else chunks.push(chunk);
        });
        response.on('error', () => reject(new DomainError('network')));
        response.on('end', () => {
          try {
            resolve(artworkData(Buffer.concat(chunks)));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', () =>
      reject(
        new DomainError(signal.aborted ? 'cancelled' : combined.aborted ? 'timeout' : 'network'),
      ),
    );
    req.end();
  });
};
