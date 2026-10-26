import { choice, ContractValidationError, record } from './validation.ts';

const definitions = {
  'invalid-input': ['输入格式无效', false],
  'invalid-response': ['服务返回了无效数据', false],
  'unauthenticated': ['请先登录', false],
  'session-expired': ['登录已过期，请重新授权', false],
  'permission-denied': ['当前账号无权执行此操作', false],
  'unavailable': ['资源暂时不可用', false],
  'rate-limited': ['请求过于频繁，请稍后重试', true],
  'network': ['网络连接失败', true],
  'timeout': ['请求超时', true],
  'cancelled': ['操作已取消', false],
  'stale-operation': ['操作已过期', false],
  'verification-required': ['平台要求安全验证，请先在官方 App 中处理后重试', false],
  'unsupported': ['暂不支持此操作', false],
  'internal': ['操作失败，请稍后重试', false],
  'engine-unavailable': ['无法启动 mpv，请确认已安装并可运行', false],
  'playback-failed': ['音频播放失败，请检查文件或音频输出', false],
  'file-unavailable': ['本地音频文件无法访问或格式不支持', false],
} as const;

export type ErrorCode = keyof typeof definitions;
export interface AppError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export function appError(code: ErrorCode): AppError {
  const validCode = choice(code, Object.keys(definitions) as ErrorCode[], 'error.code');
  const [message, retryable] = definitions[validCode];
  return Object.freeze({ code: validCode, message, retryable });
}

// 供适配器在核实平台响应后显式分类；不携带原始返回、URL 或 cause。
export class DomainError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    const safe = appError(code);
    super(safe.message);
    this.name = 'DomainError';
    this.code = safe.code;
  }
}

export function normalizeError(value: unknown): AppError {
  if (value instanceof DomainError) return appError(value.code);
  if (value instanceof ContractValidationError) return appError('invalid-response');
  if (value instanceof Error && value.name === 'AbortError') return appError('cancelled');
  if (value instanceof Error && value.name === 'TimeoutError') return appError('timeout');
  return appError('internal');
}

export function parseAppError(value: unknown): AppError {
  const input = record(value, 'error');
  // 文案和是否可重试由本地定义，绝不直接展示远端 message。
  return appError(choice(input.code, Object.keys(definitions) as ErrorCode[], 'error.code'));
}
