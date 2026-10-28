import { parseStoredPlaybackSession, type StoredPlaybackSession, type StoredPlaybackTrack, type StoredRemoteTrack } from '../../contracts/src/playback-session.ts';
import { randomInt, randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { appError, DomainError, normalizeError, type AppError } from '../../contracts/src/errors.ts';
import { adjacentIndex, parseLoopMode, parsePlaybackMode, parsePlaybackSnapshot, playbackNumber, type LoopMode, type PlaybackMode, type PlaybackSnapshot } from '../../contracts/src/playback.ts';
import { MpvClient, type MpvOptions } from './mpv-client.ts';
import { parseStreamResolution, type StreamResolution, type OnlineProviderId } from '../../contracts/src/music.ts';
import { MediaGateway } from './media-gateway.ts';

export const audioExtensions = ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'aif', 'aiff'];
const resourceErrors = new Set<AppError['code']>([
  'unavailable', 'permission-denied', 'playback-access-unknown', 'track-mismatch',
  'file-unavailable', 'playback-failed', 'network', 'timeout', 'invalid-response',
]);
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
  #originalOrder: string[] = [];
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
  #errorAdvance: ReturnType<typeof setTimeout> | undefined;
  #failedTracks = new Set<string>();
  #tail: Promise<void> = Promise.resolve();
  #seekSerial = 0;
  #seekTail: Promise<unknown> = Promise.resolve();
  #pendingSeek: { generation: number; seen: boolean; done: (restarted: boolean) => void } | undefined;
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
    const savedIds = new Set(queue.map(track => track.id));
    const current = this.#tracks[this.#state.currentIndex ?? -1];
    const currentId = current && queue.some(track => track.id === current.id) ? current.id : null;
    return parseStoredPlaybackSession({ version: 1, queue, currentId,
      positionSeconds: currentId && this.#state.status !== 'ended' ? Math.min(604800, this.#state.positionSeconds) : 0,
      durationSeconds: currentId ? Math.min(604800, this.#state.durationSeconds) : 0,
      volume: this.#desiredVolume, muted: this.#state.muted, lastAudibleVolume: this.#lastAudibleVolume,
      loopMode: this.#state.loopMode, shuffle: this.#state.shuffle,
      ...(this.#state.shuffle ? { originalOrder: this.#originalOrder.filter(id => savedIds.has(id)) } : {}) });
  }
  restoreSession(value: StoredPlaybackSession, resolve: (track: StoredRemoteTrack, signal: AbortSignal) => Promise<StreamResolution>): void {
    if (this.#tracks.length || this.#engine || this.#disposed) throw new DomainError('stale-operation');
    const saved = parseStoredPlaybackSession(value);
    this.#tracks = saved.queue.map(track => track.kind === 'local'
      ? { id: track.id, title: track.title, ...(track.artist ? { artist: track.artist } : {}), path: track.path }
      : { id: track.id, title: track.title, ...(track.artist ? { artist: track.artist } : {}), sourceId: track.sourceId, accountId: track.accountId, ...(track.durationMs === undefined ? {} : { durationMs: track.durationMs }), provider: track.kind, resolve: signal => resolve(track, signal) });
    this.#restored = new Set(saved.queue.filter(track => track.kind !== 'local').map(track => track.id));
    this.#originalOrder = saved.originalOrder ?? saved.queue.map(track => track.id);
    const index = this.#tracks.findIndex(track => track.id === saved.currentId);
    this.#desiredVolume = saved.volume; this.#lastAudibleVolume = saved.lastAudibleVolume;
    this.#bookmark = index < 0 ? undefined : { id: saved.currentId!, seconds: saved.positionSeconds, duration: saved.durationSeconds };
    this.#update({ queue: this.#queue(false), currentIndex: index < 0 ? null : index, status: index < 0 ? 'idle' : 'paused',
      positionSeconds: index < 0 ? 0 : saved.positionSeconds, durationSeconds: index < 0 ? 0 : saved.durationSeconds, volume: saved.volume, muted: saved.muted,
      loopMode: saved.loopMode ?? 'none', shuffle: saved.shuffle ?? false });
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

  #cancelErrorAdvance(resetFailures = true): void {
    clearTimeout(this.#errorAdvance); this.#errorAdvance = undefined;
    if (resetFailures) this.#failedTracks.clear();
  }

  #nextPlayableIndex(): number | null {
    let index = this.#state.currentIndex;
    if (index === null) return null;
    // Follow the current queue order and loop policy, but never retry a failed
    // item within the same recovery chain (including single-track repeat).
    for (let count = 1; count < this.#tracks.length; count++) {
      index = adjacentIndex({ ...this.#state, currentIndex: index }, 1);
      if (index === null) return null;
      if (!this.#failedTracks.has(this.#tracks[index]!.id)) return index;
    }
    return null;
  }

  #resourceFailed(error: AppError): void {
    const generation = this.#state.generation;
    const track = this.#tracks[this.#state.currentIndex ?? -1];
    this.#loaded = false;
    this.#update({ status: 'error', error });
    if (this.#disposed || this.#state.generation !== generation) return;
    if (this.#paused || !track || !resourceErrors.has(error.code)) {
      this.#cancelErrorAdvance(); return;
    }
    this.#failedTracks.add(track.id);
    if (this.#errorAdvance !== undefined || this.#nextPlayableIndex() === null) return;
    this.#errorAdvance = setTimeout(() => {
      this.#errorAdvance = undefined;
      if (this.#disposed || this.#state.generation !== generation || this.#paused || this.#state.status !== 'error') return;
      const next = this.#nextPlayableIndex();
      if (next !== null) void this.#switch(next, false, false, true);
    }, 2500);
  }

  openFiles(paths: readonly string[]): Promise<PlaybackSnapshot> {
    if (this.#disposed) return Promise.resolve(this.#state);
    if (paths.length === 0 || paths.length > 200 || paths.some((file) => !path.isAbsolute(file)
      || !audioExtensions.includes(path.extname(file).slice(1).toLowerCase()))) {
      return Promise.resolve(this.reportError(appError('file-unavailable')));
    }
    this.#tracks = paths.map((file) => ({ id: randomUUID(), title: path.basename(file), path: file }));
    this.#newQueueOrder();
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

  #queue(syncOrder = true): PlaybackSnapshot['queue'] {
    const ids = new Set(this.#tracks.map(track => track.id));
    if (syncOrder && !this.#state.shuffle) this.#originalOrder = [...ids];
    else if (syncOrder) {
      const known = new Set(this.#originalOrder);
      this.#originalOrder = [...this.#originalOrder.filter(id => ids.has(id)), ...[...ids].filter(id => !known.has(id))];
    }
    return this.#tracks.map(({ id, title, provider, artist, sourceId, detail }) => ({ id, title, provider: provider ?? 'local',
      ...(artist ? { artist } : {}), ...(sourceId ? { sourceId } : {}), ...(detail ? { detail } : {}),
    }));
  }

  // 随机顺序直接体现在队列中；上一首及下一首预览沿用同一顺序，一轮内不重复。
  #shuffleTracks(currentId?: string): void {
    const current = this.#tracks.find(track => track.id === currentId);
    const tracks = this.#tracks.filter(track => track.id !== currentId);
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = randomInt(i + 1); [tracks[i], tracks[j]] = [tracks[j]!, tracks[i]!];
    }
    this.#tracks = current ? [current, ...tracks] : tracks;
  }
  #newQueueOrder(): void {
    this.#originalOrder = this.#tracks.map(track => track.id);
    if (this.#state.shuffle) this.#shuffleTracks();
  }
  setLoopMode(mode: LoopMode): PlaybackSnapshot {
    const loop = parseLoopMode(mode);
    return this.setMode(loop === 'none' ? 'shuffle' : loop);
  }
  setShuffle(enabled: boolean): PlaybackSnapshot {
    if (typeof enabled !== 'boolean') throw new DomainError('invalid-input');
    if (!enabled && !this.#state.shuffle) return this.#state;
    return this.setMode(enabled ? 'shuffle' : 'playlist');
  }
  setMode(mode: PlaybackMode): PlaybackSnapshot {
    parsePlaybackMode(mode);
    const enabled = mode === 'shuffle';
    const currentId = this.#tracks[this.#state.currentIndex ?? -1]?.id;
    if (enabled && !this.#state.shuffle) { this.#originalOrder = this.#tracks.map(track => track.id); this.#shuffleTracks(currentId); }
    else if (!enabled && this.#state.shuffle) {
      const tracks = new Map(this.#tracks.map(track => [track.id, track]));
      this.#tracks = this.#originalOrder.flatMap(id => tracks.has(id) ? [tracks.get(id)!] : []);
    }
    const index = this.#tracks.findIndex(track => track.id === currentId);
    this.#update({ shuffle: enabled, loopMode: mode === 'shuffle' ? 'none' : mode, queue: this.#queue(false), currentIndex: index < 0 ? null : index });
    return this.#state;
  }
  next(): Promise<PlaybackSnapshot> { return this.#adjacent(1); }
  previous(): Promise<PlaybackSnapshot> { return this.#adjacent(-1); }
  #adjacent(offset: 1 | -1): Promise<PlaybackSnapshot> {
    this.#cancelErrorAdvance();
    const index = adjacentIndex(this.#state, offset);
    if (index === null) return Promise.resolve(this.#state);
    if (['idle', 'ended', 'error'].includes(this.#state.status)) return this.cueTrack(this.#tracks[index]!.id);
    return this.#switch(index, false, this.#state.status === 'paused' || (this.#state.status === 'loading' && this.#paused));
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
    this.#newQueueOrder();
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

  #switch(index: number, restore = false, paused = false, recovering = false): Promise<PlaybackSnapshot> {
    if (this.#disposed) return Promise.resolve(this.#state);
    const track = this.#tracks[index];
    if (!track) return Promise.resolve(this.#state);
    this.#cancelErrorAdvance(!recovering);
    const bookmark = restore && this.#bookmark?.id === track.id ? this.#bookmark : undefined;
    if (!restore) this.#bookmark = undefined;
    this.#pendingSeek?.done(false); this.#pendingSeek = undefined; this.#seekSerial++;
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
              this.#resourceFailed(appError('engine-unavailable'));
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
          this.#resourceFailed(normalizeError(error));
        }
      }
    });
  }

  #event(event: Record<string, unknown>): void {
    if (this.#disposed) return;
    if (event.event === 'seek') {
      if (this.#pendingSeek?.generation === this.#state.generation) this.#pendingSeek.seen = true;
    } else if (event.event === 'playback-restart') {
      if (this.#pendingSeek?.generation === this.#state.generation && this.#pendingSeek.seen) this.#pendingSeek.done(true);
    } else if (event.event === 'file-loaded') {
      this.#cancelErrorAdvance(false);
      this.#loaded = true; this.#bookmark = undefined;
      this.#update({ status: this.#paused ? 'paused' : 'playing' });
      void this.setVolume(this.#desiredVolume, false);
    } else if (event.event === 'end-file') {
      this.#pendingSeek?.done(false); this.#pendingSeek = undefined;
      this.#loaded = false;
      if (event.reason === 'eof') {
        const next = this.#state.loopMode === 'track' ? this.#state.currentIndex : adjacentIndex(this.#state, 1);
        if (next !== null) void this.#switch(next);
        else this.#update({ status: 'ended' });
      }
      else if (event.reason === 'error' || event.reason === 'redirect') {
        this.#resourceFailed(appError('playback-failed'));
      }
    } else if (event.event === 'property-change') {
      const value = event.data;
      if (event.name === 'current-ao' && typeof value === 'string' && value.length > 0) {
        this.#update({ audioOutput: value });
      } else if (event.name === 'pause' && typeof value === 'boolean') {
        this.#paused = value;
        if (this.#loaded) this.#update({ status: value ? 'paused' : 'playing' });
      } else if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        if (event.name === 'time-pos' && this.#loaded) {
          // file-loaded alone does not prove decoding succeeded. Clear the
          // failure chain only once playback actually advances.
          if (value > 0 && !this.#paused) this.#failedTracks.clear();
          this.#update({ positionSeconds: Math.min(value, this.#previewSeconds ?? Infinity) });
        }
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

  pause(): Promise<PlaybackSnapshot> {
    this.#cancelErrorAdvance();
    if (this.#state.status === 'error') this.#paused = true;
    return this.#control(['set_property', 'pause', true]);
  }
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
    const engine = this.#engine; const generation = this.#state.generation; const serial = ++this.#seekSerial;
    if (this.#disposed || !this.#loaded || !engine || this.#engineGeneration !== generation) return this.#state;
    const pending = this.#seekTail.catch(() => undefined).then(async () => {
      if (this.#disposed || serial !== this.#seekSerial || generation !== this.#state.generation || !this.#loaded) return;
      let resolve!: () => void; let restarted = false; let finished = false;
      const ready = new Promise<void>(done => { resolve = done; });
      const timer = setTimeout(() => finish(false), 3000);
      const finish = (success: boolean): void => { if (finished) return; finished = true; restarted = success; clearTimeout(timer); resolve(); };
      const request = { generation, seen: false, done: finish }; this.#pendingSeek = request;
      try {
        await engine.command(['seek', Math.min(seconds, this.#state.durationSeconds), 'absolute+exact']);
        await ready; // mpv 的命令回执早于实际定位；等待 seek/playback-restart 后再读位置。
        if (!restarted || this.#disposed || serial !== this.#seekSerial || generation !== this.#state.generation || !this.#loaded) return;
        const actual: unknown = await engine.command(['get_property', 'time-pos']);
        if (!this.#disposed && this.#loaded && serial === this.#seekSerial && generation === this.#state.generation && typeof actual === 'number' && Number.isFinite(actual) && actual >= 0) {
          const positionSeconds = Math.min(actual, this.#previewSeconds ?? Infinity);
          this.#update({ positionSeconds });
          for (const listener of this.#seekListeners) listener(positionSeconds);
        }
      } catch (error: unknown) { if (serial === this.#seekSerial && generation === this.#state.generation && !this.#disposed) this.reportError(normalizeError(error)); }
      finally { finish(false); if (this.#pendingSeek === request) this.#pendingSeek = undefined; }
    });
    this.#seekTail = pending; await pending; return this.#state;
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
    this.#cancelErrorAdvance();
    this.#pendingSeek?.done(false); this.#pendingSeek = undefined; this.#seekSerial++;
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
