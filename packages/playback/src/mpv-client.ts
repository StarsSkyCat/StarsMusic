import { spawn, type ChildProcess } from 'node:child_process';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
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
  network?: 'loopback';
  playbackLength?: number;
  startSeconds?: number;
  paused?: boolean;
}

export class MpvClient {
  #options: MpvOptions;
  #child: ChildProcess | undefined;
  #pipe: Duplex | undefined;
  #closed: Promise<void> = Promise.resolve();
  #closing = false;
  #dead = false;
  #failureReported = false;
  #buffer = '';
  #sequence = 0;
  #requests = new Map<number, PendingRequest>();

  constructor(options: MpvOptions) { this.#options = options; }

  get pid(): number | undefined { return this.#child?.pid; }

  async start(): Promise<string> {
    if (process.platform !== 'linux' && process.platform !== 'win32') throw new DomainError('unsupported');
    if (this.#child || this.#closing) throw new DomainError('unsupported');
    const protocols = this.#options.network === 'loopback' ? 'file,http,tcp' : 'file';
    // Windows mpv 自建仅当前用户/相同或更高完整性级别可访问的命名管道；不开放 TCP IPC。
    const pipeName = process.platform === 'win32' ? `\\\\.\\pipe\\starsmusic-${randomUUID()}` : undefined;
    const args = [
      '--no-config', '--load-scripts=no', '--idle=yes', '--terminal=no', '--video=no',
      '--audio-display=no', '--audio-fallback-to-null=no', '--osc=no', '--input-default-bindings=no', '--input-terminal=no',
      '--input-media-keys=no', '--ytdl=no', '--audio-file-auto=no', '--sub-auto=no',
      '--access-references=no', '--autoload-files=no', `--demuxer-lavf-o=protocol_whitelist=%${protocols.length}%${protocols}`,
      pipeName ? `--input-ipc-server=${pipeName}` : '--input-ipc-client=fd://3',
    ];
    if (this.#options.paused) args.push('--pause=yes');
    if (this.#options.startSeconds !== undefined) {
      if (!Number.isFinite(this.#options.startSeconds) || this.#options.startSeconds < 0 || this.#options.startSeconds > 604800) throw new DomainError('invalid-input');
      args.push(`--start=${this.#options.startSeconds}`);
    }
    if (this.#options.audioOutput === 'null') args.push('--ao=null');
    if (this.#options.playbackLength !== undefined) {
      if (!Number.isFinite(this.#options.playbackLength) || this.#options.playbackLength <= 0) throw new DomainError('invalid-input');
      args.push(`--length=${this.#options.playbackLength}`);
    }
    const child = spawn(this.#options.executable ?? (process.platform === 'win32' ? 'mpv.exe' : 'mpv'), args, {
      shell: false, windowsHide: true, stdio: pipeName ? ['ignore', 'ignore', 'ignore'] : ['ignore', 'ignore', 'ignore', 'pipe'],
    });
    this.#child = child;
    this.#closed = new Promise((resolve) => child.once('close', () => {
      this.#dead = true;
      this.#pipe?.destroy();
      this.#rejectRequests();
      this.#failure();
      resolve();
    }));
    child.on('error', () => this.#rejectRequests());
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', () => reject(new DomainError('engine-unavailable')));
      });
      if (this.#closing || this.#dead) throw new DomainError('engine-unavailable');
      this.#pipe = pipeName ? await this.#connect(pipeName) : child.stdio[3] as Duplex;
      if (this.#closing || this.#dead) { this.#pipe.destroy(); throw new DomainError('engine-unavailable'); }
      this.#pipe.setEncoding('utf8');
      this.#pipe.on('data', (chunk: string) => this.#receive(chunk));
      this.#pipe.on('error', () => { this.#rejectRequests(); this.#failure(); });
      this.#pipe.on('close', () => { this.#rejectRequests(); this.#failure(); });
      const version = await this.command(['get_property', 'mpv-version']);
      if (typeof version !== 'string') throw new DomainError('invalid-response');
      for (const [index, name] of ['time-pos', 'duration', 'pause', 'volume', 'current-ao'].entries()) {
        await this.command(['observe_property', index + 1, name]);
      }
      return version;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async #connect(name: string): Promise<Socket> {
    const deadline = Date.now() + 3000;
    while (!this.#closing && !this.#dead && Date.now() < deadline) {
      try {
        return await new Promise<Socket>((resolve, reject) => {
          const socket = createConnection(name);
          const timer = setTimeout(() => socket.destroy(new Error('mpv.connect-timeout')), Math.max(1, deadline - Date.now()));
          socket.once('error', error => { clearTimeout(timer); socket.destroy(); reject(error); });
          socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && code !== 'EBUSY') throw new DomainError('engine-unavailable');
        await delay(20);
      }
    }
    throw new DomainError('engine-unavailable');
  }

  #failure(): void {
    if (this.#closing || this.#failureReported) return;
    this.#failureReported = true;
    this.#options.onFailure();
  }

  command(command: readonly unknown[]): Promise<unknown> {
    if (!this.#pipe || this.#pipe.destroyed || this.#dead || this.#closing) return Promise.reject(new DomainError('engine-unavailable'));
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
      this.#failure();
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
    // 命名管道服务器不会随客户端断开退出；先发送 quit，再沿用有界进程清理。
    if (process.platform === 'win32' && this.#pipe?.writable && !this.#pipe.destroyed && !this.#dead) {
      this.#pipe.write(`${JSON.stringify({ command: ['quit'] })}\n`, () => this.#pipe?.destroy());
    } else this.#pipe?.destroy(); // Linux 在继承的 IPC 客户端关闭后退出。
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
    this.#pipe?.destroy();
  }
}
