import { choice, ContractValidationError, nonNegativeInteger, record } from './validation.ts';
import { kugouCatalogId, kugouHash } from './kugou-catalog.ts';
import { parsePresentationContent } from './presentation.ts';
export interface KugouArtworkRequest { readonly kind: 'track' | 'playlist'; readonly id: string; readonly generation: number }
export function parseKugouArtworkRequest(value: unknown): KugouArtworkRequest {
  const raw = record(value, 'kugou.artwork.request');
  if (Object.keys(raw).some(key => !['kind', 'id', 'generation'].includes(key))) throw new ContractValidationError('kugou.artwork.request');
  const kind = choice(raw.kind, ['track', 'playlist'], 'kugou.artwork.kind');
  return Object.freeze({ kind, id: kind === 'track' ? kugouHash(raw.id) : kugouCatalogId(raw.id), generation: nonNegativeInteger(raw.generation, 'kugou.artwork.generation') });
}
export function parseKugouArtwork(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new ContractValidationError('kugou.artwork');
  return parsePresentationContent({ lyrics: [], artwork: value }).artwork!;
}
