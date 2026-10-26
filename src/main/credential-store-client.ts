import { Worker } from 'node:worker_threads';
import {
  parseStoredCredentials,
  type CredentialStore,
  type StoredCredentials,
} from '../../packages/storage/src/credential-store.ts';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
export class CredentialStoreClient implements CredentialStore {
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
      else request.reject(new Error('vault.storage-failed'));
    });
    this.#worker.on('error', () => this.#fail());
    this.#worker.on('exit', () => this.#fail());
  }
  #fail(): void {
    this.#failed = true;
    for (const request of this.#requests.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('vault.storage-failed'));
    }
    this.#requests.clear();
  }
  #request(
    operation: 'read' | 'write' | 'reset' | 'close',
    value?: StoredCredentials,
  ): Promise<unknown> {
    if (this.#closed || this.#failed) return Promise.reject(new Error('vault.storage-closed'));
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
  async read(): Promise<StoredCredentials | undefined> {
    const value = await this.#request('read');
    return value === undefined ? undefined : parseStoredCredentials(value);
  }
  async write(value: StoredCredentials): Promise<void> {
    await this.#request('write', parseStoredCredentials(value));
  }
  async reset(): Promise<void> {
    await this.#request('reset');
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
