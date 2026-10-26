// 错误只包含固定字段名，不回显未知输入、地址或凭据。
export class ContractValidationError extends Error {
  constructor(field: string) {
    super(`契约字段无效：${field}`);
    this.name = 'ContractValidationError';
  }
}

export function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ContractValidationError(field);
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ContractValidationError(field);
  return value;
}

export function choice<const T extends readonly string[]>(value: unknown, choices: T, field: string): T[number] {
  if (typeof value !== 'string' || !choices.includes(value)) throw new ContractValidationError(field);
  return value as T[number];
}

export function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ContractValidationError(field);
  }
  return value;
}

export function positiveNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ContractValidationError(field);
  }
  return value;
}
