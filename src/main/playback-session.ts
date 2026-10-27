import type { MusicPlayer } from '../../packages/playback/src/player.ts';
import type { StoredRemoteTrack } from '../../packages/contracts/src/playback-session.ts';
import type { StreamResolution } from '../../packages/contracts/src/music.ts';
import type { PlaybackSessionStore } from '../../packages/storage/src/playback-session-store.ts';

// 时间位置最多每 3 秒写入；结构/设置变更合并 200ms。退出先冻结并冲刷，再销毁播放器。
export class PlaybackSession {
  #unsubscribe: (() => void) | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #due = Infinity;
  #pending = false;
  #writing: Promise<void> | undefined;
  #enabled = false;
  #closing = false;
  readonly player: MusicPlayer; readonly store: PlaybackSessionStore;
  constructor(player: MusicPlayer, store: PlaybackSessionStore) { this.player = player; this.store = store; }
  async initialize(resolve: (track: StoredRemoteTrack, signal: AbortSignal) => Promise<StreamResolution>): Promise<void> {
    try {
      const saved = await this.store.read();
      if (saved) this.player.restoreSession(saved, resolve);
      this.#enabled = true;
    } catch { this.player.reportSaveError(true); } // 保留损坏/新版原库，不以空队列覆盖。
    let previous = this.player.snapshot();
    this.#unsubscribe = this.player.subscribe(state => {
      const old = previous; previous = state;
      if (this.#closing || !this.#enabled || old.saveError?.code !== state.saveError?.code) return;
      this.#pending = true;
      const progress = old.positionSeconds !== state.positionSeconds || old.durationSeconds !== state.durationSeconds;
      const due = Date.now() + (progress ? 3000 : 200);
      if (due >= this.#due) return;
      clearTimeout(this.#timer); this.#due = due;
      this.#timer = setTimeout(() => { this.#timer = undefined; this.#due = Infinity; void this.#flush(); }, Math.max(0, due - Date.now()));
    });
  }
  async #flush(): Promise<void> {
    if (this.#writing) return this.#writing;
    this.#writing = (async () => {
      while (this.#pending && this.#enabled) {
        this.#pending = false;
        try { await this.store.write(this.player.exportSession()); this.player.reportSaveError(false); }
        catch { this.player.reportSaveError(true); break; }
      }
    })();
    try { await this.#writing; } finally { this.#writing = undefined; }
  }
  async close(): Promise<void> {
    if (this.#closing) return;
    this.#closing = true; this.#unsubscribe?.(); clearTimeout(this.#timer);
    await this.#writing;
    this.#pending = this.#enabled;
    await this.#flush();
    await this.store.close();
  }
}
