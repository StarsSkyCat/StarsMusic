import { DomainError } from '../../contracts/src/errors.ts';

export function parseApiJson(json: string): unknown {
  return JSON.parse(json, (_key: string, value: unknown, context?: { source?: string }): unknown => {
    if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
      if (context?.source && /^\d+$/.test(context.source)) return context.source;
      throw new DomainError('invalid-response');
    }
    return value;
  }) as unknown;
}

