import { parseStoredPlaybackSession, type StoredPlaybackSession, type StoredPlaybackTrack, type StoredRemoteTrack } from '../../contracts/src/playback-session.ts';
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
  id: string; title: string; artist?: string; sourceId?: string; accountId?: string; durationMs?: number; detail?: string; path?: string; provider?: OnlineProviderId;
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
  #lastAudibleVolume = 70;
  #volumeRevision = 0;
  #volumeWrite: Promise<void> | undefined;
  #restored = new Set<string>();
  #bookmark: { id: string; seconds: number; duration: number } | undefined;
  #previewSeconds: number | undefined;
  #disposed = false;
  #tail: Promise<void> = Promise.resolve();
  #seekListeners = new Set<(seconds: number) => void>();
  #listeners = new Set<(state: PlaybackSnapshot) => void>();
  #options: PlayerOptions;

  constructor(options: PlayerOptions = {}) { this.#options = options; }

  snapshot(): PlaybackSnapshot { return this.#state; }

  storedTrack(id: string): StoredPlaybackTrack | undefined {
    const track = this.#tracks.find(track => track.id === id);
    return track ? this.#storedTrack(track) : undefined;
  }
  #storedTrack(track: PlayerTrack): StoredPlaybackTrack | undefined {
    const base = { id: track.id, title: track.title, ...(track.artist ? { artist: track.artist } : {}) };
    if (track.path) return { ...base, kind: 'local', path: track.path };
    if (track.provider && track.sourceId && track.accountId) return { ...base, kind: track.provider, sourceId: track.sourceId, accountId: track.accountId, ...(track.durationMs === undefined ? {} : { durationMs: track.durationMs }) };
    return undefined;
  }
  exportSession(): StoredPlaybackSession {
    const queue = this.#tracks.flatMap(track => { const saved = this.#storedTrack(track); return saved ? [saved] : []; });
    const current = this.#tracks[this.#state.currentIndex ?? -1];
    const currentId = current && queue.some(track => track.id === current.id) ? current.id : null;
    return parseStoredPlaybackSession({ version: 1, queue, currentId,
      positionSeconds: currentId && this.#state.status !== 'ended' ? Math.min(604800, this.#state.positionSeconds) : 0,
      durationSeconds: currentId ? Math.min(604800, this.#state.durationSeconds) : 0,
      volume: this.#desiredVolume, muted: this.#state.muted, lastAudibleVolume: this.#lastAudibleVolume });
  }
  restoreSession(value: StoredPlaybackSession, resolve: (track: StoredRemoteTrack, signal: AbortSignal) => Promise<StreamResolution>): void {
    if (this.#tracks.length || this.#engine || this.#disposed) throw new DomainError('stale-operation');
    const saved = parseStoredPlaybackSession(value);
    this.#tracks = saved.queue.map(track => track.kind === 'local'
      ? { id: track.id, title: track.title, ...(track.artist ? { artist: track.artist } : {}), path: track.path }
      : { id: track.id, title: track.title, ...(track.artist ? { artist: track.artist } : {}), sourceId: track.sourceId, accountId: track.accountId, ...(track.durationMs === undefined ? {} : { durationMs: track.durationMs }), provider: track.kind, resolve: signal => resolve(track, signal) });
    this.#restored = new Set(saved.queue.filter(track => track.kind !== 'local').map(track => track.id));
    const index = this.#tracks.findIndex(track => track.id === saved.currentId);
    this.#desiredVolume = saved.volume; this.#lastAudibleVolume = saved.lastAudibleVolume;
    this.#bookmark = index < 0 ? undefined : { id: saved.currentId!, seconds: saved.positionSeconds, duration: saved.durationSeconds };
    this.#update({ queue: this.#queue(), currentIndex: index < 0 ? null : index, status: index < 0 ? 'idle' : 'paused',
      positionSeconds: index < 0 ? 0 : saved.positionSeconds, durationSeconds: index < 0 ? 0 : saved.durationSeconds, volume: saved.volume, muted: saved.muted });
  }
  async bindRestoredProvider(provider: OnlineProviderId, accountId: string): Promise<void> {
    await this.#removeTracks(track => track.provider === provider && this.#restored.has(track.id) && track.accountId !== accountId);
    for (const track of this.#tracks) if (track.provider === provider && track.accountId === accountId) this.#restored.delete(track.id);
  }

  subscribe(listener: (state: PlaybackSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  #update(patch: Omit<Partial<PlaybackSnapshot>, 'error' | 'audioOutput' | 'saveError'> & { error?: AppError | undefined; saveError?: AppError | undefined; audioOutput?: string | undefined }): void {
    this.#state = parsePlaybackSnapshot({ ...this.#state, ...patch, revision: this.#state.revision + 1 });
    for (const listener of this.#listeners) listener(this.#state);
  }

  reportSaveError(failed: boolean): void {
    if (!!this.#state.saveError !== failed) this.#update({ saveError: failed ? appError('playback-save-failed') : undefined });
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

  playTrack(id: string, paused = false): Promise<PlaybackSnapshot> {
    const index = this.#tracks.findIndex((track) => track.id === id);
    if (index < 0) return Promise.resolve(this.reportError(appError('invalid-input')));
    return this.#switch(index, false, paused);
  }

  cueTrack(id: string): Promise<PlaybackSnapshot> {
    const index = this.#tracks.findIndex(track => track.id === id);
    if (index < 0) return Promise.resolve(this.reportError(appError('invalid-input')));
    const stopping = this.stop();
    this.#update({ currentIndex: index });
    return stopping.then(() => this.#state);
  }
  subscribeSeeked(listener: (seconds: number) => void): () => void {
    this.#seekListeners.add(listener); return () => { this.#seekListeners.delete(listener); };
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

  openRemote(provider: OnlineProviderId, title: string, resolve: (signal: AbortSignal) => Promise<StreamResolution>, artist?: string, sourceId?: string, accountId?: string, durationMs?: number): Promise<PlaybackSnapshot> {
    if (this.#disposed) return Promise.resolve(this.#state);
    if (this.#tracks.length >= 10000) return Promise.resolve(this.reportError(appError('invalid-input')));
    const track: PlayerTrack = { id: randomUUID(), title, resolve, provider, ...(durationMs === undefined ? {} : { durationMs }), ...(accountId ? { accountId } : {}), ...(artist ? { artist } : {}), ...(sourceId ? { sourceId } : {}) };
    this.#tracks.push(track);
    this.#update({ queue: this.#queue() });
    return this.#switch(this.#tracks.length - 1);
  }

  openRemoteList(provider: OnlineProviderId, tracks: readonly { title: string; sourceId: string; artist?: string; accountId?: string; durationMs?: number; resolve: (signal: AbortSignal) => Promise<StreamResolution> }[]): Promise<PlaybackSnapshot> {
    if (this.#disposed) return Promise.resolve(this.#state);
    if (!tracks.length || tracks.length > 10000) throw new DomainError('invalid-input');
    this.#tracks = tracks.map(track => ({ ...track, id: randomUUID(), provider }));
    this.#update({ queue: this.#queue(), currentIndex: null, status: 'idle' });
    return this.#switch(0);
  }
  enqueueRemoteNext(provider: OnlineProviderId, title: string, resolve: (signal: AbortSignal) => Promise<StreamResolution>, artist?: string, sourceId?: string, accountId?: string, durationMs?: number): PlaybackSnapshot {
    if (this.#disposed) return this.#state;
    if (this.#tracks.length >= 10000) throw new DomainError('invalid-input');
    const track: PlayerTrack = { id: randomUUID(), title, resolve, provider, ...(durationMs === undefined ? {} : { durationMs }), ...(accountId ? { accountId } : {}), ...(artist ? { artist } : {}), ...(sourceId ? { sourceId } : {}) };
    this.#tracks.splice((this.#state.currentIndex ?? -1) + 1, 0, track);
    this.#update({ queue: this.#queue() });
    return this.#state;
  }

  clearRemote(provider: OnlineProviderId, preserveRestored = false): Promise<void> {
    return this.#removeTracks(track => track.provider === provider && (!preserveRestored || !this.#restored.has(track.id)));
  }
  async #removeTracks(remove: (track: PlayerTrack) => boolean): Promise<void> {
    if (!this.#tracks.some(remove)) return;
    const current = this.#tracks[this.#state.currentIndex ?? -1];
    const stopping = current && remove(current) ? this.stop() : undefined;
    const removed = new Set(this.#tracks.filter(remove).map(track => track.id));
    this.#tracks = this.#tracks.filter(track => !removed.has(track.id));
    for (const id of removed) this.#restored.delete(id);
    const index = current ? this.#tracks.findIndex(track => track.id === current.id) : -1;
    this.#update({ queue: this.#queue(), currentIndex: index < 0 ? null : index });
    await stopping;
  }

  #enqueue(task: () => Promise<void>): Promise<PlaybackSnapshot> {
    this.#tail = this.#tail.then(task).catch((error: unknown) => {
      if (!this.#disposed) this.reportError(normalizeError(error));
    });
    return this.#tail.then(() => this.#state);
  }

  #switch(index: number, restore = false, paused = false): Promise<PlaybackSnapshot> {
    if (this.#disposed) return Promise.resolve(this.#state);
    const track = this.#tracks[index];
    if (!track) return Promise.resolve(this.#state);
    const bookmark = restore && this.#bookmark?.id === track.id ? this.#bookmark : undefined;
    if (!restore) this.#bookmark = undefined;
    const generation = this.#state.generation + 1;
    this.#abort.abort(); this.#abort = new AbortController();
    const signal = this.#abort.signal;
    this.#loaded = false;
    this.#paused = paused;
    this.#previewSeconds = undefined;
    this.#update({ generation, currentIndex: index, status: 'loading', positionSeconds: bookmark?.seconds ?? 0, durationSeconds: bookmark?.duration ?? 0, error: undefined, audioOutput: undefined });
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
          track.detail = `${stream.access.kind === 'preview' ? '试听 · ' : '完整播放 · '}${quality}`;
          this.#update({ queue: this.#queue() });
        } else {
          try {
            if (!track.path) throw new Error('no file');
            filename = await realpath(track.path);
            if (!(await stat(filename)).isFile()) throw new Error('not a file');
          } catch { throw new DomainError('file-unavailable'); }
        }
        if (this.#disposed || this.#state.generation !== generation) return;
        const startSeconds = Math.max(0, Math.min(bookmark?.seconds ?? 0, Math.max(0, (previewSeconds ?? bookmark?.duration ?? Infinity) - .2)));
        engine = new MpvClient({
          ...this.#options, startSeconds, paused,
          ...(track.resolve ? { network: 'loopback' as const } : {}),
          ...(previewSeconds === undefined ? {} : { playbackLength: Math.max(.1, previewSeconds - startSeconds) }),
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
        await engine.command(['set_property', 'volume', this.#state.muted ? 0 : this.#desiredVolume]);
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
      this.#loaded = true; this.#bookmark = undefined;
      this.#update({ status: this.#paused ? 'paused' : 'playing' });
      void this.setVolume(this.#desiredVolume, false);
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
        else if (event.name === 'volume' && this.#loaded && !this.#state.muted && Math.abs(value - this.#desiredVolume) < .01) this.#update({ volume: Math.min(value, 100) });
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
    if (this.#state.currentIndex !== null && (!this.#loaded || ['ended', 'idle', 'error'].includes(this.#state.status))) {
      return this.#switch(this.#state.currentIndex, this.#bookmark !== undefined);
    }
    return this.#control(['set_property', 'pause', false]);
  }
  async seek(seconds: number): Promise<PlaybackSnapshot> {
    playbackNumber(seconds);
    if (!this.#loaded && this.#bookmark) {
      const positionSeconds = Math.min(seconds, this.#state.durationSeconds);
      this.#bookmark.seconds = positionSeconds; this.#update({ positionSeconds });
      for (const listener of this.#seekListeners) listener(positionSeconds);
      return this.#state;
    }
    const engine = this.#engine; const generation = this.#state.generation;
    if (this.#disposed || !this.#loaded || !engine || this.#engineGeneration !== generation) return this.#state;
    try {
      await engine.command(['seek', Math.min(seconds, this.#state.durationSeconds), 'absolute+exact']);
      const actual: unknown = await engine.command(['get_property', 'time-pos']);
      if (!this.#disposed && this.#loaded && generation === this.#state.generation && typeof actual === 'number' && Number.isFinite(actual) && actual >= 0) {
        const positionSeconds = Math.min(actual, this.#previewSeconds ?? Infinity);
        this.#update({ positionSeconds });
        for (const listener of this.#seekListeners) listener(positionSeconds);
      }
    } catch (error: unknown) { if (generation === this.#state.generation && !this.#disposed) this.reportError(normalizeError(error)); }
    return this.#state;
  }
  async #flushVolume(): Promise<void> {
    if (this.#volumeWrite) return this.#volumeWrite;
    this.#volumeWrite = (async () => {
      let delivered = -1;
      while (this.#loaded && delivered !== this.#volumeRevision && !this.#disposed) {
        const revision = this.#volumeRevision;
        await this.#control(['set_property', 'volume', this.#state.muted ? 0 : this.#desiredVolume]);
        delivered = revision;
      }
    })();
    try { await this.#volumeWrite; } finally { this.#volumeWrite = undefined; }
  }
  async setVolume(volume: number, unmute = true): Promise<PlaybackSnapshot> {
    playbackNumber(volume, 100); this.#desiredVolume = volume;
    if (volume > 0) this.#lastAudibleVolume = volume;
    this.#volumeRevision++;
    this.#update({ volume, ...(unmute ? { muted: false } : {}) });
    if (this.#loaded) await this.#flushVolume();
    return this.#state;
  }
  async setMuted(muted: boolean): Promise<PlaybackSnapshot> {
    if (typeof muted !== 'boolean') throw new DomainError('invalid-input');
    if (!muted && this.#desiredVolume === 0) this.#desiredVolume = this.#lastAudibleVolume;
    this.#volumeRevision++; this.#update({ muted, volume: this.#desiredVolume });
    if (this.#loaded) await this.#flushVolume();
    return this.#state;
  }

  stop(): Promise<PlaybackSnapshot> {
    this.#bookmark = undefined;
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
    this.#listeners.clear(); this.#seekListeners.clear();
  }
}
