import { DomainError } from '../../../contracts/src/errors.ts';
import type { KugouTrack } from '../../../contracts/src/kugou.ts';
import { record } from '../../../contracts/src/validation.ts';
import { parseLrc } from '../lyrics.ts';

export type LyricRequest = (
  endpoint: 'search' | 'download',
  params: Record<string, string>,
  signal: AbortSignal,
) => Promise<unknown>;
export const requestLyric: LyricRequest = async (endpoint, params, signal) => {
  const target =
    endpoint === 'search' ? 'https://krcs.kugou.com/search' : 'https://krcs.kugou.com/download';
  const response = await fetch(`${target}?${new URLSearchParams(params)}`, {
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    headers: { Accept: 'application/json' },
  }).catch(() => {
    throw new DomainError(signal.aborted ? 'cancelled' : 'network');
  });
  if (!response.ok) throw new DomainError('unavailable');
  const reader = response.body?.getReader();
  if (!reader) throw new DomainError('invalid-response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 1_000_000) throw new DomainError('invalid-response');
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new DomainError('invalid-response');
  }
};
function title(value: string): string {
  return value
    .replace(/\.(?:mp3|flac|m4a|wav|ogg|aac|ape|opus)$/i, '')
    .replace(/^.*?\s+[-–—]\s+/, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}
export async function getKugouLyrics(
  track: KugouTrack,
  signal: AbortSignal,
  request: LyricRequest = requestLyric,
) {
  const search = record(
    await request(
      'search',
      {
        ver: '1',
        man: 'yes',
        client: 'pc',
        keyword: '',
        hash: track.id,
        duration: String(Math.round(track.durationMs / 1000)),
      },
      signal,
    ),
    'kugou.lyric.search',
  );
  if (!Array.isArray(search.candidates)) return [];
  const candidates = search.candidates
    .slice(0, 50)
    .map((value) => record(value, 'kugou.lyric.candidate'));
  const candidate = candidates.find(
    (row) =>
      (typeof row.id === 'string' ||
        (typeof row.id === 'number' && Number.isSafeInteger(row.id))) &&
      /^\d{1,30}$/.test(String(row.id)) &&
      typeof row.accesskey === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(row.accesskey) &&
      typeof row.song === 'string' &&
      title(row.song) === title(track.name),
  );
  if (!candidate) return [];
  const result = record(
    await request(
      'download',
      {
        ver: '1',
        client: 'pc',
        id: String(candidate.id),
        accesskey: candidate.accesskey as string,
        fmt: 'lrc',
        charset: 'utf8',
      },
      signal,
    ),
    'kugou.lyric.download',
  );
  if (
    typeof result.content !== 'string' ||
    result.content.length > 700_000 ||
    !/^[A-Za-z0-9+/\r\n]+=*$/.test(result.content)
  )
    throw new DomainError('invalid-response');
  signal.throwIfAborted();
  return parseLrc(Buffer.from(result.content, 'base64').toString('utf8'));
}
