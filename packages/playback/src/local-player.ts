import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { appError, DomainError, normalizeError, type AppError } from '../../contracts/src/errors.ts';
import { parsePlaybackSnapshot, playbackNumber, type PlaybackSnapshot } from '../../contracts/src/playback.ts';
import { MpvClient, type MpvOptions } from './mpv-client.ts';

export const audioExtensions = ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'aif', 'aiff'];
interface LocalTrack { id: string; title: string; path: string }

export class LocalPlayer {
  #state = parsePlaybackSnapshot({
    revision: 0, generation: 0, status: 'idle', queue: [], currentIndex: null,
    positionSeconds: 0, durationSeconds: 0, volume: 70,
  });
  #tracks: LocalTrack[] = [];
  #engine: MpvClient | undefined;
  #engineGeneration = -1;
  #loaded = false;
  #paused = false;
  #desiredVolume = 70;
  #disposed = false;
  #tail: Promise<void> = Promise.resolve();
  #listeners = new Set<(state: PlaybackSnapshot) => void>();
  #options: Pick<MpvOptions, 'executable' | 'audioOutput'>;

  constructor(options: Pick<MpvOptions, 'executable' | 'audioOutput'> = {}) { this.#options = options; }

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
    this.#update({ queue: this.#tracks.map(({ id, title }) => ({ id, title })), currentIndex: null, status: 'idle' });
    return this.#switch(0);
  }

  playTrack(id: string): Promise<PlaybackSnapshot> {
    const index = this.#tracks.findIndex((track) => track.id === id);
    if (index < 0) return Promise.resolve(this.reportError(appError('invalid-input')));
    return this.#switch(index);
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
    this.#loaded = false;
    this.#paused = false;
    this.#update({ generation, currentIndex: index, status: 'loading', positionSeconds: 0, durationSeconds: 0, error: undefined, audioOutput: undefined });
    return this.#enqueue(async () => {
      const old = this.#engine;
      this.#engine = undefined;
      await old?.close();
      if (this.#disposed || this.#state.generation !== generation) return;
      let engine: MpvClient | undefined;
      try {
        let filename: string;
        try {
          filename = await realpath(track.path);
          if (!(await stat(filename)).isFile()) throw new Error('not a file');
        } catch { throw new DomainError('file-unavailable'); }
        if (this.#disposed || this.#state.generation !== generation) return;
        engine = new MpvClient({
          ...this.#options,
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
      if (event.reason === 'eof') this.#update({ status: 'ended' });
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
        if (event.name === 'time-pos' && this.#loaded) this.#update({ positionSeconds: value });
        else if (event.name === 'duration') this.#update({ durationSeconds: value });
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
    this.#loaded = false;
    this.#update({ generation: this.#state.generation + 1, status: 'idle', positionSeconds: 0, durationSeconds: 0, error: undefined });
    return this.#enqueue(async () => {
      const engine = this.#engine;
      this.#engine = undefined;
      await engine?.close();
    });
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return this.#tail;
    this.#disposed = true;
    await this.stop();
    this.#listeners.clear();
  }
}
