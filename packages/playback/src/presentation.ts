import { normalizeError } from '../../contracts/src/errors.ts';
import type { PlaybackSnapshot, QueueTrack } from '../../contracts/src/playback.ts';
import {
  parsePresentationContent,
  parsePresentationSnapshot,
  type PresentationContent,
  type PresentationSnapshot,
} from '../../contracts/src/presentation.ts';

export class PresentationController {
  #state = parsePresentationSnapshot({ revision: 0, generation: 0, trackId: null, status: 'idle' });
  #key = '';
  #abort = new AbortController();
  #listeners = new Set<(state: PresentationSnapshot) => void>();
  #resolve: (track: QueueTrack, signal: AbortSignal) => Promise<PresentationContent>;
  constructor(resolve: (track: QueueTrack, signal: AbortSignal) => Promise<PresentationContent>) {
    this.#resolve = resolve;
  }
  snapshot(): PresentationSnapshot {
    return this.#state;
  }
  subscribe(listener: (state: PresentationSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  #publish(state: Omit<PresentationSnapshot, 'revision'>): void {
    this.#state = parsePresentationSnapshot({ ...state, revision: this.#state.revision + 1 });
    for (const listener of this.#listeners) listener(this.#state);
  }
  select(playback: PlaybackSnapshot): void {
    const track = playback.queue[playback.currentIndex ?? -1];
    const key = `${playback.generation}:${track?.id ?? ''}`;
    if (key === this.#key) return;
    this.#key = key;
    this.#abort.abort();
    this.#abort = new AbortController();
    const signal = this.#abort.signal;
    const base = { generation: playback.generation, trackId: track?.id ?? null };
    if (
      !track ||
      !track.sourceId ||
      !track.provider ||
      track.provider === 'local' ||
      playback.status === 'idle'
    ) {
      this.#publish({ ...base, status: track ? 'unavailable' : 'idle' });
      return;
    }
    this.#publish({ ...base, status: 'loading' });
    void this.#resolve(track, signal)
      .then((value) => {
        if (signal.aborted || key !== this.#key) return;
        const content = parsePresentationContent(value);
        this.#publish({
          ...base,
          content,
          status: content.lyrics.length || content.artwork ? 'ready' : 'unavailable',
        });
      })
      .catch((error) => {
        if (!signal.aborted && key === this.#key)
          this.#publish({ ...base, status: 'error', error: normalizeError(error) });
      });
  }
  dispose(): void {
    this.#abort.abort();
    this.#listeners.clear();
  }
}
