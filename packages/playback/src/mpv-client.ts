import { spawn, type ChildProcess } from 'node:child_process';
import type { Duplex } from 'node:stream';
import { DomainError } from '../../contracts/src/errors.ts';

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface MpvOptions {
  onEvent: (event: Record<string, unknown>) => void;
  onFailure: () => void;
  executable?: string;
  // 仅测试调用者显式使用；产品启动不读取环境变量开启静音后端。
  audioOutput?: 'null';
}

export class MpvClient {
  #options: MpvOptions;
  #child: ChildProcess | undefined;
  #pipe: Duplex | undefined;
  #closed: Promise<void> = Promise.resolve();
  #closing = false;
  #dead = false;
  #buffer = '';
  #sequence = 0;
  #requests = new Map<number, PendingRequest>();

  constructor(options: MpvOptions) { this.#options = options; }

  get pid(): number | undefined { return this.#child?.pid; }

  async start(): Promise<string> {
    if (process.platform !== 'linux') throw new DomainError('unsupported');
    if (this.#child || this.#closing) throw new DomainError('unsupported');
    const args = [
      '--no-config', '--load-scripts=no', '--idle=yes', '--terminal=no', '--video=no',
      '--audio-display=no', '--audio-fallback-to-null=no', '--osc=no', '--input-default-bindings=no', '--input-terminal=no',
      '--input-media-keys=no', '--ytdl=no', '--audio-file-auto=no', '--sub-auto=no',
      '--access-references=no', '--autoload-files=no', '--demuxer-lavf-o=protocol_whitelist=file',
      '--input-ipc-client=fd://3',
    ];
    if (this.#options.audioOutput === 'null') args.push('--ao=null');
    const child = spawn(this.#options.executable ?? 'mpv', args, {
      shell: false, stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
    });
    this.#child = child;
    this.#closed = new Promise((resolve) => child.once('close', () => {
      this.#dead = true;
      this.#rejectRequests();
      if (!this.#closing) this.#options.onFailure();
      resolve();
    }));
    child.on('error', () => this.#rejectRequests());
    this.#pipe = child.stdio[3] as Duplex;
    this.#pipe.setEncoding('utf8');
    this.#pipe.on('data', (chunk: string) => this.#receive(chunk));
    this.#pipe.on('error', () => this.#rejectRequests());
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', () => reject(new DomainError('engine-unavailable')));
    });
    const version = await this.command(['get_property', 'mpv-version']);
    if (typeof version !== 'string') throw new DomainError('invalid-response');
    for (const [index, name] of ['time-pos', 'duration', 'pause', 'volume', 'current-ao'].entries()) {
      await this.command(['observe_property', index + 1, name]);
    }
    return version;
  }

  command(command: readonly unknown[]): Promise<unknown> {
    if (!this.#pipe || this.#pipe.destroyed || this.#dead) return Promise.reject(new DomainError('engine-unavailable'));
    const requestId = ++this.#sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#requests.delete(requestId);
        reject(new DomainError('timeout'));
      }, 3000);
      this.#requests.set(requestId, { resolve, reject, timer });
      this.#pipe!.write(`${JSON.stringify({ command, request_id: requestId })}\n`, (error) => {
        if (error) this.#rejectRequests();
      });
    });
  }

  #receive(chunk: string): void {
    this.#buffer += chunk;
    if (this.#buffer.length > 1024 * 1024) {
      this.#pipe?.destroy();
      this.#rejectRequests();
      if (!this.#closing) this.#options.onFailure();
      return;
    }
    let newline: number;
    while ((newline = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      let value: unknown;
      try { value = JSON.parse(line); } catch { continue; }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      const message = value as Record<string, unknown>;
      if (typeof message.request_id === 'number') {
        const request = this.#requests.get(message.request_id);
        if (!request) continue;
        clearTimeout(request.timer);
        this.#requests.delete(message.request_id);
        if (message.error === 'success') request.resolve(message.data);
        else request.reject(new DomainError('playback-failed'));
      } else if (typeof message.event === 'string' && !this.#closing) {
        this.#options.onEvent(message);
      }
    }
  }

  #rejectRequests(): void {
    for (const request of this.#requests.values()) {
      clearTimeout(request.timer);
      request.reject(new DomainError('engine-unavailable'));
    }
    this.#requests.clear();
  }

  async close(): Promise<void> {
    if (this.#closing) return this.#closed;
    this.#closing = true;
    this.#pipe?.destroy(); // mpv 在继承的 IPC 客户端关闭后退出。
    this.#rejectRequests();
    const child = this.#child;
    if (!child || this.#dead) return this.#closed;
    const wait = async (milliseconds: number): Promise<void> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([this.#closed, new Promise<void>((resolve) => { timer = setTimeout(resolve, milliseconds); })]);
      clearTimeout(timer);
    };
    await wait(500);
    if (!this.#dead) { child.kill('SIGTERM'); await wait(500); }
    if (!this.#dead) child.kill('SIGKILL');
    await this.#closed;
  }
}
