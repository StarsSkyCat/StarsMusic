import { DomainError } from '../../contracts/src/errors.ts';
import type { LyricLine } from '../../contracts/src/presentation.ts';

export function parseLrc(value: unknown): readonly LyricLine[] {
  if (typeof value !== 'string' || value.length > 500_000)
    throw new DomainError('invalid-response');
  const offset = Number(/\[offset:([+-]?\d+)\]/i.exec(value)?.[1] ?? 0);
  const rows = new Map<number, string[]>();
  for (const line of value.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const content = line
      .replace(/\[[^\]]*\]/g, '')
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
      .trim();
    if (!content) continue;
    for (const tag of tags) {
      if (Number(tag[2]) >= 60) continue;
      const fraction = (tag[3] ?? '').padEnd(3, '0');
      const timeMs = Math.max(
        0,
        Number(tag[1]) * 60000 + Number(tag[2]) * 1000 + Number(fraction) + offset,
      );
      if (!Number.isSafeInteger(timeMs) || timeMs > 86_400_000) continue;
      const texts = rows.get(timeMs) ?? [];
      if (!texts.includes(content)) texts.push(content);
      rows.set(timeMs, texts);
      if (rows.size > 2000) throw new DomainError('invalid-response');
    }
  }
  return [...rows]
    .sort(([a], [b]) => a - b)
    .map(([timeMs, texts]) => ({ timeMs, text: texts.join('\n').slice(0, 1000) }));
}
