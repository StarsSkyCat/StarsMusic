import { parseStoredPlaybackSession, type StoredPlaybackSession } from '../../packages/contracts/src/playback-session.ts';
import { Worker } from 'node:worker_threads';
import {
  type PlaybackSessionStore,
} from '../../packages/storage/src/playback-session-store.ts';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
export class PlaybackSessionStoreClient implements PlaybackSessionStore {
  readonly #worker: Worker;
  readonly #requests = new Map<number, Pending>();
  #sequence = 0;
  #closed = false;
  #failed = false;
  constructor(workerPath: string, file: string) {
    this.#worker = new Worker(workerPath, { workerData: { file }, stdout: true, stderr: true });
    this.#worker.stdout?.resume();
    this.#worker.stderr?.resume();
    this.#worker.on('message', (value: unknown) => {
      if (typeof value !== 'object' || value === null) return;
      const message = value as Record<string, unknown>;
      if (typeof message.id !== 'number') return;
      const request = this.#requests.get(message.id);
      if (!request) return;
      this.#requests.delete(message.id);
      clearTimeout(request.timer);
      if (message.ok === true) request.resolve(message.result);
      else request.reject(new Error('playback.storage-failed'));
    });
    this.#worker.on('error', () => this.#fail());
    this.#worker.on('exit', () => this.#fail());
  }
  #fail(): void {
    this.#failed = true;
    for (const request of this.#requests.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('playback.storage-failed'));
    }
    this.#requests.clear();
  }
  #request(
    operation: 'read' | 'write' | 'close',
    value?: StoredPlaybackSession,
  ): Promise<unknown> {
    if (this.#closed || this.#failed) return Promise.reject(new Error('playback.storage-closed'));
    const id = ++this.#sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#fail();
        void this.#worker.terminate();
      }, 10000);
      this.#requests.set(id, { resolve, reject, timer });
      this.#worker.postMessage({ id, operation, ...(value === undefined ? {} : { value }) });
    });
  }
  async read(): Promise<StoredPlaybackSession | undefined> {
    const value = await this.#request('read');
    return value === undefined ? undefined : parseStoredPlaybackSession(value);
  }
  async write(value: StoredPlaybackSession): Promise<void> {
    await this.#request('write', parseStoredPlaybackSession(value));
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    try {
      await this.#request('close');
    } finally {
      this.#closed = true;
      await this.#worker.terminate();
      this.#fail();
    }
  }
}
