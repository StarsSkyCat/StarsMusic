import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { appError, DomainError, normalizeError, type AppError } from '../../contracts/src/errors.ts';
import { parsePlaybackSnapshot, playbackNumber, type PlaybackSnapshot } from '../../contracts/src/playback.ts';
import { MpvClient, type MpvOptions } from './mpv-client.ts';
import { parseStreamResolution, type StreamResolution, type OnlineProviderId } from '../../contracts/src/music.ts';
import { MediaGateway } from './media-gateway.ts';

export const audioExtensions = ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'aif', 'aiff'];
interface PlayerTrack {
  id: string; title: string; artist?: string; sourceId?: string; detail?: string; path?: string; provider?: OnlineProviderId;
  resolve?: (signal: AbortSignal) => Promise<StreamResolution>;
}
interface PlayerOptions extends Pick<MpvOptions, 'executable' | 'audioOutput'> {
  openGateway?: (url: string, signal: AbortSignal, provider: OnlineProviderId) => Promise<MediaGateway>;
}

export class MusicPlayer {
  #state = parsePlaybackSnapshot({
    revision: 0, generation: 0, status: 'idle', queue: [], currentIndex: null,
    positionSeconds: 0, durationSeconds: 0, volume: 70,
  });
  #tracks: PlayerTrack[] = [];
  #abort = new AbortController();
  #gateway: MediaGateway | undefined;
  #engine: MpvClient | undefined;
  #engineGeneration = -1;
  #loaded = false;
  #paused = false;
  #desiredVolume = 70;
  #previewSeconds: number | undefined;
  #disposed = false;
  #tail: Promise<void> = Promise.resolve();
  #listeners = new Set<(state: PlaybackSnapshot) => void>();
  #options: PlayerOptions;

  constructor(options: PlayerOptions = {}) { this.#options = options; }

  snapshot(): PlaybackSnapshot { return this.#state; }

  subscribe(listener: (state: PlaybackSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  #update(patch: Omit<Partial<PlaybackSnapshot>, 'error' | 'audioOutput'> & { error?: AppError | undefined; audioOutput?: string | undefined }): void {
    this.#state = parsePlaybackSnapshot({ ...this.#state, ...patch, revision: this.#state.revision + 1 });
    for (const listener of this.#listeners) listener(this.#state);
  }

  reportError(error: AppError): PlaybackSnapshot {
    this.#update({ error });
    return this.#state;
  }

  openFiles(paths: readonly string[]): Promise<PlaybackSnapshot> {
    if (this.#disposed) return Promise.resolve(this.#state);
    if (paths.length === 0 || paths.length > 200 || paths.some((file) => !path.isAbsolute(file)
      || !audioExtensions.includes(path.extname(file).slice(1).toLowerCase()))) {
      return Promise.resolve(this.reportError(appError('file-unavailable')));
    }
    this.#tracks = paths.map((file) => ({ id: randomUUID(), title: path.basename(file), path: file }));
    this.#update({ queue: this.#queue(), currentIndex: null, status: 'idle' });
    return this.#switch(0);
  }

  playTrack(id: string): Promise<PlaybackSnapshot> {
    const index = this.#tracks.findIndex((track) => track.id === id);
    if (index < 0) return Promise.resolve(this.reportError(appError('invalid-input')));
    return this.#switch(index);
  }

  #queue(): PlaybackSnapshot['queue'] {
    return this.#tracks.map(({ id, title, provider, artist, sourceId, detail }) => ({ id, title, provider: provider ?? 'local',
      ...(artist ? { artist } : {}), ...(sourceId ? { sourceId } : {}), ...(detail ? { detail } : {}),
    }));
  }

  moveNext(id: string): PlaybackSnapshot {
    const currentId = this.#state.queue[this.#state.currentIndex ?? -1]?.id;
    const index = this.#tracks.findIndex((track) => track.id === id);
    if (index < 0) return this.reportError(appError('invalid-input'));
    if (id === currentId) return this.#state;
    const [track] = this.#tracks.splice(index, 1);
    const currentIndex = this.#tracks.findIndex((track) => track.id === currentId);
    this.#tracks.splice(currentIndex + 1, 0, track!);
    this.#update({ queue: this.#queue(), currentIndex: currentId ? currentIndex : null });
    return this.#state;
  }

  removeTrack(id: string): PlaybackSnapshot {
    const currentId = this.#state.queue[this.#state.currentIndex ?? -1]?.id;
    if (id === currentId) return this.#state;
    if (!this.#tracks.some((track) => track.id === id)) return this.reportError(appError('invalid-input'));
    this.#tracks = this.#tracks.filter((track) => track.id !== id);
    this.#update({ queue: this.#queue(), currentIndex: currentId ? this.#tracks.findIndex((track) => track.id === currentId) : null });
    return this.#state;
  }

  clearUpcoming(): PlaybackSnapshot {
    this.#tracks = this.#tracks.slice(0, (this.#state.currentIndex ?? -1) + 1);
    this.#update({ queue: this.#queue() });
    return this.#state;
  }

  openRemote(provider: OnlineProviderId, title: string, resolve: (signal: AbortSignal) => Promise<StreamResolution>, artist?: string, sourceId?: string): Promise<PlaybackSnapshot> {
    if (this.#disposed) return Promise.resolve(this.#state);
    if (this.#tracks.length >= 200) return Promise.resolve(this.reportError(appError('invalid-input')));
    const track: PlayerTrack = { id: randomUUID(), title, resolve, provider, ...(artist ? { artist } : {}), ...(sourceId ? { sourceId } : {}) };
    this.#tracks.push(track);
    this.#update({ queue: this.#queue() });
    return this.#switch(this.#tracks.length - 1);
  }

  enqueueRemoteNext(provider: OnlineProviderId, title: string, resolve: (signal: AbortSignal) => Promise<StreamResolution>, artist?: string, sourceId?: string): PlaybackSnapshot {
    if (this.#disposed) return this.#state;
    if (this.#tracks.length >= 200) throw new DomainError('invalid-input');
    const track: PlayerTrack = { id: randomUUID(), title, resolve, provider, ...(artist ? { artist } : {}), ...(sourceId ? { sourceId } : {}) };
    this.#tracks.splice((this.#state.currentIndex ?? -1) + 1, 0, track);
    this.#update({ queue: this.#queue() });
    return this.#state;
  }

  async clearRemote(provider: OnlineProviderId): Promise<void> {
    if (!this.#tracks.some((track) => track.provider === provider)) return;
    const current = this.#tracks[this.#state.currentIndex ?? -1];
    const stopping = current?.provider === provider ? this.stop() : undefined;
    this.#tracks = this.#tracks.filter((track) => track.provider !== provider);
    const index = current ? this.#tracks.findIndex((track) => track.id === current.id) : -1;
    this.#update({ queue: this.#queue(), currentIndex: index < 0 ? null : index });
    await stopping;
  }

  #enqueue(task: () => Promise<void>): Promise<PlaybackSnapshot> {
    this.#tail = this.#tail.then(task).catch((error: unknown) => {
      if (!this.#disposed) this.reportError(normalizeError(error));
    });
    return this.#tail.then(() => this.#state);
  }

  #switch(index: number): Promise<PlaybackSnapshot> {
    if (this.#disposed) return Promise.resolve(this.#state);
    const track = this.#tracks[index];
    if (!track) return Promise.resolve(this.#state);
    const generation = this.#state.generation + 1;
    this.#abort.abort(); this.#abort = new AbortController();
    const signal = this.#abort.signal;
    this.#loaded = false;
    this.#paused = false;
    this.#previewSeconds = undefined;
    this.#update({ generation, currentIndex: index, status: 'loading', positionSeconds: 0, durationSeconds: 0, error: undefined, audioOutput: undefined });
    return this.#enqueue(async () => {
      const old = this.#engine;
      this.#engine = undefined;
      await old?.close();
      await this.#gateway?.close(); this.#gateway = undefined;
      if (this.#disposed || this.#state.generation !== generation) return;
      let engine: MpvClient | undefined;
      try {
        let filename: string; let previewSeconds: number | undefined;
        if (track.resolve) {
          const stream = parseStreamResolution(await track.resolve(signal));
          signal.throwIfAborted();
          if (stream.track.provider !== track.provider || stream.source.kind !== 'remote' || Object.keys(stream.source.headers).length !== 0) throw new DomainError('invalid-response');
          if (stream.source.expiresAt !== undefined && stream.source.expiresAt <= Date.now()) throw new DomainError('unavailable');
          this.#gateway = await (this.#options.openGateway?.(stream.source.url, signal, track.provider!) ?? MediaGateway.open(stream.source.url, signal, undefined, track.provider!));
          filename = this.#gateway.address;
          if (stream.access.kind === 'preview') previewSeconds = stream.access.durationMs / 1000;
          signal.throwIfAborted();
          if (this.#disposed || this.#state.generation !== generation) return;
          this.#previewSeconds = previewSeconds;
          const quality = { unknown: '音质未知', standard: '标准', high: '高音质', lossless: '无损', 'hi-res': 'Hi-Res' }[stream.quality.level];
          track.detail = `${stream.access.kind === 'preview' ? '试听 · ' : ''}${quality}`;
          this.#update({ queue: this.#queue() });
        } else {
          try {
            if (!track.path) throw new Error('no file');
            filename = await realpath(track.path);
            if (!(await stat(filename)).isFile()) throw new Error('not a file');
          } catch { throw new DomainError('file-unavailable'); }
        }
        if (this.#disposed || this.#state.generation !== generation) return;
        engine = new MpvClient({
          ...this.#options,
          ...(track.resolve ? { network: 'loopback' as const } : {}),
          ...(previewSeconds === undefined ? {} : { playbackLength: previewSeconds }),
          onEvent: (event) => { if (this.#state.generation === generation) this.#event(event); },
          onFailure: () => {
            if (!this.#disposed && this.#state.generation === generation) {
              this.#loaded = false;
              this.#update({ status: 'error', error: appError('engine-unavailable') });
            }
          },
        });
        this.#engine = engine;
        this.#engineGeneration = generation;
        const version = await engine.start();
        if (this.#disposed || this.#state.generation !== generation) return;
        this.#update({ engineVersion: version });
        await engine.command(['set_property', 'http-header-fields', []]);
        await engine.command(['set_property', 'volume', this.#desiredVolume]);
        await engine.command(['loadfile', filename, 'replace']);
      } catch (error: unknown) {
        await engine?.close();
        await this.#gateway?.close(); this.#gateway = undefined;
        if (this.#engine === engine) this.#engine = undefined;
        if (!this.#disposed && this.#state.generation === generation) {
          this.#loaded = false;
          this.#update({ status: 'error', error: normalizeError(error) });
        }
      }
    });
  }

  #event(event: Record<string, unknown>): void {
    if (this.#disposed) return;
    if (event.event === 'file-loaded') {
      this.#loaded = true;
      this.#update({ status: this.#paused ? 'paused' : 'playing' });
      void this.#control(['set_property', 'volume', this.#desiredVolume]);
    } else if (event.event === 'end-file') {
      this.#loaded = false;
      if (event.reason === 'eof') {
        const next = (this.#state.currentIndex ?? -1) + 1;
        if (next < this.#tracks.length) void this.#switch(next);
        else this.#update({ status: 'ended' });
      }
      else if (event.reason === 'error' || event.reason === 'redirect') {
        this.#update({ status: 'error', error: appError('playback-failed') });
      }
    } else if (event.event === 'property-change') {
      const value = event.data;
      if (event.name === 'current-ao' && typeof value === 'string' && value.length > 0) {
        this.#update({ audioOutput: value });
      } else if (event.name === 'pause' && typeof value === 'boolean') {
        this.#paused = value;
        if (this.#loaded) this.#update({ status: value ? 'paused' : 'playing' });
      } else if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        if (event.name === 'time-pos' && this.#loaded) this.#update({ positionSeconds: Math.min(value, this.#previewSeconds ?? Infinity) });
        else if (event.name === 'duration') this.#update({ durationSeconds: Math.min(value, this.#previewSeconds ?? Infinity) });
        else if (event.name === 'volume' && this.#loaded) this.#update({ volume: Math.min(value, 100) });
      }
    }
  }

  async #control(command: readonly unknown[]): Promise<PlaybackSnapshot> {
    const generation = this.#state.generation;
    const engine = this.#engine;
    if (this.#disposed || !engine || this.#engineGeneration !== generation || !this.#loaded) return this.#state;
    try { await engine.command(command); }
    catch (error: unknown) {
      if (this.#state.generation === generation) this.reportError(normalizeError(error));
    }
    return this.#state;
  }

  pause(): Promise<PlaybackSnapshot> { return this.#control(['set_property', 'pause', true]); }
  resume(): Promise<PlaybackSnapshot> {
    if (this.#state.currentIndex !== null && ['ended', 'idle', 'error'].includes(this.#state.status)) {
      return this.#switch(this.#state.currentIndex);
    }
    return this.#control(['set_property', 'pause', false]);
  }
  seek(seconds: number): Promise<PlaybackSnapshot> {
    playbackNumber(seconds);
    return this.#control(['seek', Math.min(seconds, this.#state.durationSeconds), 'absolute+exact']);
  }
  async setVolume(volume: number): Promise<PlaybackSnapshot> {
    playbackNumber(volume, 100);
    this.#desiredVolume = volume;
    if (!this.#loaded) { this.#update({ volume }); return this.#state; }
    return this.#control(['set_property', 'volume', volume]);
  }

  stop(): Promise<PlaybackSnapshot> {
    this.#abort.abort();
    this.#loaded = false;
    this.#update({ generation: this.#state.generation + 1, status: 'idle', positionSeconds: 0, durationSeconds: 0, error: undefined });
    return this.#enqueue(async () => {
      const engine = this.#engine;
      this.#engine = undefined;
      await engine?.close();
      await this.#gateway?.close(); this.#gateway = undefined;
    });
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return this.#tail;
    this.#disposed = true;
    await this.stop();
    this.#listeners.clear();
  }
}
