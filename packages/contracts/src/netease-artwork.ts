import { choice, ContractValidationError, nonNegativeInteger, record } from './validation.ts';
import { catalogId } from './netease-catalog.ts';
import { parsePresentationContent } from './presentation.ts';

export interface NeteaseArtworkRequest { readonly kind: 'track' | 'playlist'; readonly id: string; readonly generation: number }
export function parseNeteaseArtworkRequest(value: unknown): NeteaseArtworkRequest {
  const raw = record(value, 'netease.artwork.request');
  if (Object.keys(raw).some(key => !['kind', 'id', 'generation'].includes(key))) throw new ContractValidationError('netease.artwork.request');
  return Object.freeze({ kind: choice(raw.kind, ['track', 'playlist'], 'netease.artwork.kind'), id: catalogId(raw.id), generation: nonNegativeInteger(raw.generation, 'netease.artwork.generation') });
}
export function parseNeteaseArtwork(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new ContractValidationError('netease.artwork');
  return parsePresentationContent({ lyrics: [], artwork: value }).artwork!;
}
