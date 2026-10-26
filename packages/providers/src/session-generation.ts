import { normalizeError, type AppError } from '../../contracts/src/errors.ts';
import { parseOnlineContext, type OnlineProviderContext, type OnlineProviderId } from '../../contracts/src/music.ts';
import { choice } from '../../contracts/src/validation.ts';

export interface SessionLease {
  readonly context: OnlineProviderContext;
  readonly generation: number;
  readonly signal: AbortSignal;
}

export type RequestOutcome =
  | { readonly status: 'applied' }
  | { readonly status: 'discarded' }
  | { readonly status: 'failed'; readonly error: AppError };

interface ActiveSession {
  lease: SessionLease;
  controller: AbortController;
}

// 后台服务持有；不保存凭据，也不将 lease 暴露给 renderer。
export class SessionGeneration {
  #active = new Map<OnlineProviderId, ActiveSession>();
  #generations = new Map<OnlineProviderId, number>();

  #next(provider: OnlineProviderId): number {
    const generation = (this.#generations.get(provider) ?? 0) + 1;
    if (!Number.isSafeInteger(generation)) throw new Error('会话 generation 已耗尽');
    this.#generations.set(provider, generation);
    return generation;
  }

  activate(value: unknown): SessionLease {
    const context = parseOnlineContext(value);
    const generation = this.#next(context.provider);
    const previous = this.#active.get(context.provider);
    const controller = new AbortController();
    const lease: SessionLease = Object.freeze({ context, generation, signal: controller.signal });
    // 先替换活动身份，再发出同步 abort 事件，防止旧监听器重入后回写。
    this.#active.set(context.provider, { lease, controller });
    previous?.controller.abort();
    return lease;
  }

  invalidate(value: OnlineProviderId): void {
    const provider = choice(value, ['netease', 'kugou'], 'session.provider');
    this.#next(provider);
    const previous = this.#active.get(provider);
    this.#active.delete(provider);
    previous?.controller.abort();
  }

  isCurrent(lease: SessionLease): boolean {
    return this.#active.get(lease.context.provider)?.lease === lease && !lease.signal.aborted;
  }

  // apply 必须同步完成。返回 undefined 的签名阻止直接传入 async 回调。
  commit(lease: SessionLease, apply: () => undefined): boolean {
    if (!this.isCurrent(lease)) return false;
    apply();
    return true;
  }

  async run<T>(
    lease: SessionLease,
    request: (signal: AbortSignal) => Promise<T>,
    apply: (value: T) => undefined,
  ): Promise<RequestOutcome> {
    if (!this.isCurrent(lease)) return { status: 'discarded' };
    try {
      const value = await request(lease.signal);
      return { status: this.commit(lease, () => apply(value)) ? 'applied' : 'discarded' };
    } catch (error: unknown) {
      if (!this.isCurrent(lease)) return { status: 'discarded' };
      return { status: 'failed', error: normalizeError(error) };
    }
  }
}
