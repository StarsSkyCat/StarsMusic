import { parseNeteaseArtwork, type NeteaseArtworkRequest } from '../../packages/contracts/src/netease-artwork';
import { parsePresentationContent, type PresentationContent } from '../../packages/contracts/src/presentation';
import { utilityProcess, type UtilityProcess } from 'electron';
import { DomainError, normalizeError, parseAppError } from '../../packages/contracts/src/errors';
import { initialNeteaseSnapshot, parseNeteaseSnapshot, parseNeteaseQueue, type NeteaseTrack, type NeteaseSnapshot } from '../../packages/contracts/src/netease';
import { parseStreamResolution, type StreamResolution } from '../../packages/contracts/src/music';
import { parseCredentialBundle, type NeteaseCredentialBundle } from '../../packages/contracts/src/credentials';

interface Request {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
type Operation = 'preparePlaylist' | 'refreshMembership' | 'getState' | 'startLogin' | 'cancelLogin' | 'logout' | 'loadPlaylists' | 'loadPlaylist' | 'browse' | 'restoreCredentials' | 'exportCredentials' | 'resolveTrack' | 'getPresentation' | 'getArtwork';

export class NeteaseClient {
  #worker: UtilityProcess | undefined;
  #path: string;
  #state = initialNeteaseSnapshot();
  #workerRevision = -1;
  #workerGeneration = -1;
  #publicGeneration = 0;
  #sequence = 0;
  #requests = new Map<number, Request>();
  #listeners = new Set<(state: NeteaseSnapshot) => void>();
  #credentialListeners = new Set<(bundle: NeteaseCredentialBundle) => void>();
  #disposed = false;

  constructor(workerPath: string) { this.#path = workerPath; }
  snapshot(): NeteaseSnapshot { return this.#state; }
  subscribe(listener: (state: NeteaseSnapshot) => void): () => void {
    this.#listeners.add(listener); return () => { this.#listeners.delete(listener); };
  }
  subscribeCredentials(listener: (bundle: NeteaseCredentialBundle) => void): () => void {
    this.#credentialListeners.add(listener); return () => { this.#credentialListeners.delete(listener); };
  }
  #publish(value: unknown): void {
    const state = parseNeteaseSnapshot(value);
    if (state.revision < this.#workerRevision) return;
    this.#workerRevision = state.revision;
    if (state.generation !== this.#workerGeneration) { this.#workerGeneration = state.generation; this.#publicGeneration++; }
    this.#state = parseNeteaseSnapshot({ ...state, generation: this.#publicGeneration, revision: this.#state.revision + 1 });
    for (const listener of this.#listeners) listener(this.#state);
  }
  #start(): UtilityProcess {
    if (this.#disposed) throw new DomainError('cancelled');
    if (this.#worker) return this.#worker;
    const worker = utilityProcess.fork(this.#path, [], { stdio: 'pipe', serviceName: 'StarsMusic Netease Provider' });
    this.#worker = worker; this.#workerRevision = -1; this.#workerGeneration = -1;
    // 防止依赖或运行时意外输出包含登录响应的内容，也避免未读取管道阻塞。
    worker.stdout?.resume(); worker.stderr?.resume();
    worker.on('message', (value: unknown) => {
      if (this.#worker !== worker || typeof value !== 'object' || value === null) return;
      const message = value as Record<string, unknown>;
      try {
        if (message.kind === 'state') this.#publish(message.state);
        else if (message.kind === 'credentials') {
          const bundle = parseCredentialBundle(message.credentials);
          if (bundle.provider !== 'netease') throw new DomainError('invalid-response');
          for (const listener of this.#credentialListeners) listener(bundle);
        }
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
    this.#state = parseNeteaseSnapshot({ ...initialNeteaseSnapshot(), revision: this.#state.revision + 1, generation: this.#publicGeneration,
      status: this.#disposed ? 'signed-out' : 'failed', ...(this.#disposed ? {} : { error: normalizeError(new DomainError('unavailable')) }) });
    for (const listener of this.#listeners) listener(this.#state);
  }
  #request(operation: Operation, args: Record<string, unknown> = {}): Promise<unknown> {
    const worker = this.#start();
    const requestId = ++this.#sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#requests.delete(requestId); reject(new DomainError('timeout')); this.#fail(worker);
      }, operation === 'preparePlaylist' ? 90000 : operation === 'browse' || operation === 'refreshMembership' ? 45000 : 30000);
      this.#requests.set(requestId, { resolve, reject, timer });
      worker.postMessage({ operation, requestId, ...args });
    });
  }
  async command(operation: Exclude<Operation, 'resolveTrack' | 'getPresentation' | 'getArtwork' | 'preparePlaylist'>, args: Record<string, unknown> = {}): Promise<NeteaseSnapshot> {
    const generation = this.#state.generation;
    try { this.#publish(await this.#request(operation, args)); }
    catch (error: unknown) {
      if (!this.#disposed && generation === this.#state.generation) {
        this.#state = parseNeteaseSnapshot({ ...this.#state, error: normalizeError(error), revision: this.#state.revision + 1 });
        for (const listener of this.#listeners) listener(this.#state);
      }
    }
    return this.#state;
  }
  restoreCredentials(bundle: NeteaseCredentialBundle): Promise<NeteaseSnapshot> {
    return this.command('restoreCredentials', { credentials: bundle });
  }
  async exportCredentials(): Promise<NeteaseCredentialBundle | undefined> {
    if (this.#state.status !== 'connected') return undefined;
    const value = await this.#request('exportCredentials');
    if (value === null || value === undefined) return undefined;
    const bundle = parseCredentialBundle(value);
    if (bundle.provider !== 'netease') throw new DomainError('invalid-response');
    return bundle;
  }
  async preparePlaylist(id: string, generation: number): Promise<readonly NeteaseTrack[]> {
    if (this.#state.status !== 'connected' || this.#state.generation !== generation) throw new DomainError('stale-operation');
    const result = await this.#request('preparePlaylist', { id });
    if (this.#state.status !== 'connected' || this.#state.generation !== generation) throw new DomainError('stale-operation');
    return parseNeteaseQueue(result);
  }
  async getArtwork(request: NeteaseArtworkRequest): Promise<string | null> {
    if (this.#state.generation !== request.generation) throw new DomainError('stale-operation');
    const value = await this.#request('getArtwork', { artwork: { ...request, generation: this.#workerGeneration } });
    if (this.#state.generation !== request.generation) throw new DomainError('stale-operation');
    return parseNeteaseArtwork(value);
  }
  async getPresentation(id: string, generation: number, signal: AbortSignal): Promise<PresentationContent> {
    signal.throwIfAborted();
    if (this.#state.status !== 'connected' || this.#state.generation !== generation) throw new DomainError('stale-operation');
    const value = await this.#request('getPresentation', { id, generation: this.#workerGeneration });
    signal.throwIfAborted();
    if (this.#state.status !== 'connected' || this.#state.generation !== generation) throw new DomainError('stale-operation');
    return parsePresentationContent(value);
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
    this.#listeners.clear(); this.#credentialListeners.clear();
  }
}
