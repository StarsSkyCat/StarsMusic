import { utilityProcess, type UtilityProcess } from 'electron';
import { DomainError, normalizeError, parseAppError } from '../../packages/contracts/src/errors';
import { initialKugouSnapshot, parseKugouSnapshot, type KugouSnapshot } from '../../packages/contracts/src/kugou';
import { parseStreamResolution, type StreamResolution } from '../../packages/contracts/src/music';

interface Request {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
type Operation = 'getState' | 'startLogin' | 'cancelLogin' | 'logout' | 'loadPlaylists' | 'loadPlaylist' | 'resolveTrack';

export class KugouClient {
  #worker: UtilityProcess | undefined;
  #path: string;
  #state = initialKugouSnapshot();
  #workerRevision = -1;
  #workerGeneration = -1;
  #publicGeneration = 0;
  #sequence = 0;
  #requests = new Map<number, Request>();
  #listeners = new Set<(state: KugouSnapshot) => void>();
  #disposed = false;

  constructor(workerPath: string) { this.#path = workerPath; }
  snapshot(): KugouSnapshot { return this.#state; }
  subscribe(listener: (state: KugouSnapshot) => void): () => void {
    this.#listeners.add(listener); return () => { this.#listeners.delete(listener); };
  }
  #publish(value: unknown): void {
    const state = parseKugouSnapshot(value);
    if (state.revision < this.#workerRevision) return;
    this.#workerRevision = state.revision;
    if (state.generation !== this.#workerGeneration) { this.#workerGeneration = state.generation; this.#publicGeneration++; }
    this.#state = parseKugouSnapshot({ ...state, generation: this.#publicGeneration, revision: this.#state.revision + 1 });
    for (const listener of this.#listeners) listener(this.#state);
  }
  #start(): UtilityProcess {
    if (this.#disposed) throw new DomainError('cancelled');
    if (this.#worker) return this.#worker;
    const worker = utilityProcess.fork(this.#path, [], { stdio: 'pipe', serviceName: 'StarsMusic Kugou Provider' });
    this.#worker = worker; this.#workerRevision = -1; this.#workerGeneration = -1;
    // 防止依赖或运行时意外输出包含登录响应的内容，也避免未读取管道阻塞。
    worker.stdout?.resume();
    if (process.env.STARSMUSIC_DEBUG === '1') worker.stderr?.on('data', (chunk: Buffer | string) => console.error(`[kugou-worker] ${String(chunk).trim()}`));
    else worker.stderr?.resume();
    worker.on('message', (value: unknown) => {
      if (this.#worker !== worker || typeof value !== 'object' || value === null) return;
      const message = value as Record<string, unknown>;
      try {
        if (message.kind === 'state') this.#publish(message.state);
        else if (message.kind === 'reply' && typeof message.requestId === 'number') {
          const request = this.#requests.get(message.requestId);
          if (!request) return;
          this.#requests.delete(message.requestId); clearTimeout(request.timer);
          if (message.ok === true) request.resolve(message.result);
          else request.reject(new DomainError(parseAppError(message.error).code));
        }
      } catch { this.#fail(worker); }
    });
    worker.once('exit', () => { if (this.#worker === worker) this.#fail(worker); });
    return worker;
  }
  #fail(worker: UtilityProcess): void {
    if (this.#worker !== worker) return;
    this.#worker = undefined; worker.kill();
    for (const request of this.#requests.values()) { clearTimeout(request.timer); request.reject(new DomainError('unavailable')); }
    this.#requests.clear();
    this.#publicGeneration++;
    this.#state = parseKugouSnapshot({ ...initialKugouSnapshot(), revision: this.#state.revision + 1, generation: this.#publicGeneration,
      status: this.#disposed ? 'signed-out' : 'failed', ...(this.#disposed ? {} : { error: normalizeError(new DomainError('unavailable')) }) });
    for (const listener of this.#listeners) listener(this.#state);
  }
  #request(operation: Operation, args: Record<string, unknown> = {}): Promise<unknown> {
    const worker = this.#start();
    const requestId = ++this.#sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#requests.delete(requestId); reject(new DomainError('timeout')); this.#fail(worker);
      }, 30000);
      this.#requests.set(requestId, { resolve, reject, timer });
      worker.postMessage({ operation, requestId, ...args });
    });
  }
  async command(operation: Exclude<Operation, 'resolveTrack'>, args: Record<string, unknown> = {}): Promise<KugouSnapshot> {
    try { this.#publish(await this.#request(operation, args)); }
    catch (error: unknown) {
      if (!this.#disposed) {
        this.#state = parseKugouSnapshot({ ...this.#state, error: normalizeError(error), revision: this.#state.revision + 1 });
        for (const listener of this.#listeners) listener(this.#state);
      }
    }
    return this.#state;
  }
  async resolveTrack(id: string, generation: number, signal: AbortSignal): Promise<StreamResolution> {
    signal.throwIfAborted();
    if (this.#state.status !== 'connected' || this.#state.generation !== generation) throw new DomainError('stale-operation');
    const accountId = this.#state.account?.id;
    const value = await this.#request('resolveTrack', { id, generation: this.#workerGeneration });
    signal.throwIfAborted();
    if (this.#state.status !== 'connected' || this.#state.generation !== generation || this.#state.account?.id !== accountId) throw new DomainError('stale-operation');
    return parseStreamResolution(value);
  }
  async dispose(): Promise<void> {
    this.#disposed = true;
    const worker = this.#worker;
    if (!worker) return;
    const exit = new Promise<void>((resolve) => worker.once('exit', () => resolve()));
    this.#fail(worker);
    await exit;
    this.#listeners.clear();
  }
}
