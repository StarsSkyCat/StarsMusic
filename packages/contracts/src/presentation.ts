import { parseAppError, type AppError } from './errors.ts';
import { choice, ContractValidationError, nonNegativeInteger, record, text } from './validation.ts';

export interface LyricLine {
  readonly timeMs: number;
  readonly text: string;
}
export interface PresentationContent {
  readonly lyrics: readonly LyricLine[];
  readonly artwork?: string;
  readonly album?: string;
  readonly lyricsError?: AppError;
  readonly artworkError?: AppError;
}
export interface PresentationSnapshot {
  readonly revision: number;
  readonly generation: number;
  readonly trackId: string | null;
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  readonly content?: PresentationContent;
  readonly error?: AppError;
}
export const presentationChannels = {
  getState: 'starsmusic:presentation:get-state',
  changed: 'starsmusic:presentation:changed',
} as const;
export interface PresentationApi {
  getState(): Promise<PresentationSnapshot>;
  onChanged(listener: (state: PresentationSnapshot) => void): () => void;
}
export function parsePresentationContent(value: unknown): PresentationContent {
  const raw = record(value, 'presentation.content');
  if (!Array.isArray(raw.lyrics) || raw.lyrics.length > 2000)
    throw new ContractValidationError('presentation.lyrics');
  let previous = -1;
  const lyrics = raw.lyrics.map((value: unknown) => {
    const row = record(value, 'presentation.line');
    const timeMs = nonNegativeInteger(row.timeMs, 'presentation.time');
    const content = text(row.text, 'presentation.text');
    if (timeMs < previous || timeMs > 86_400_000 || content.length > 1000)
      throw new ContractValidationError('presentation.line');
    previous = timeMs;
    return Object.freeze({ timeMs, text: content });
  });
  if (
    raw.artwork !== undefined &&
    (typeof raw.artwork !== 'string' ||
      raw.artwork.length > 750_000 ||
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(raw.artwork))
  )
    throw new ContractValidationError('presentation.artwork');
  if (raw.album !== undefined && (typeof raw.album !== 'string' || raw.album.length > 500))
    throw new ContractValidationError('presentation.album');
  return Object.freeze({
    lyrics: Object.freeze(lyrics),
    ...(raw.artwork === undefined ? {} : { artwork: raw.artwork as string }),
    ...(raw.album === undefined ? {} : { album: raw.album as string }),
    ...(raw.lyricsError === undefined ? {} : { lyricsError: parseAppError(raw.lyricsError) }),
    ...(raw.artworkError === undefined ? {} : { artworkError: parseAppError(raw.artworkError) }),
  });
}
export function parsePresentationSnapshot(value: unknown): PresentationSnapshot {
  const raw = record(value, 'presentation');
  return Object.freeze({
    revision: nonNegativeInteger(raw.revision, 'presentation.revision'),
    generation: nonNegativeInteger(raw.generation, 'presentation.generation'),
    trackId: raw.trackId === null ? null : text(raw.trackId, 'presentation.trackId'),
    status: choice(
      raw.status,
      ['idle', 'loading', 'ready', 'unavailable', 'error'],
      'presentation.status',
    ),
    ...(raw.content === undefined ? {} : { content: parsePresentationContent(raw.content) }),
    ...(raw.error === undefined ? {} : { error: parseAppError(raw.error) }),
  });
}
export function activeLyricIndex(lines: readonly LyricLine[], positionSeconds: number): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (lines[mid]!.timeMs <= positionSeconds * 1000) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}
