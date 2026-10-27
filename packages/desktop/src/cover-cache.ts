import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import type { PresentationSnapshot } from '../../contracts/src/presentation.ts';
import type { PlaybackSnapshot } from '../../contracts/src/playback.ts';

// 仅将已校验的内存栅格封面提供给同用户的桌面客户端；不公开音频路径或源站地址。
export class DesktopCoverCache {
  #directory: Promise<string> | undefined; #epoch = 0; #disposed = false; #last = '';
  async update(presentation: PresentationSnapshot, playback: PlaybackSnapshot): Promise<string | undefined> {
    const epoch = ++this.#epoch; const track = playback.queue[playback.currentIndex ?? -1];
    if (this.#disposed || presentation.generation !== playback.generation || presentation.trackId !== track?.id) return undefined;
    const image = presentation.content?.artwork;
    if (!image) return undefined;
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!match || image.length > 3000000) return undefined;
    const directory = await (this.#directory ??= mkdtemp(path.join(tmpdir(), 'starsmusic-desktop-art-')));
    const file = path.join(directory, `${epoch}.${match[1]}`);
    await writeFile(file, Buffer.from(match[2]!, 'base64'), { flag: 'wx', mode: 0o600 });
    if (this.#disposed || epoch !== this.#epoch) { await rm(file, { force: true }); return undefined; }
    const old = this.#last; this.#last = file; if (old) await rm(old, { force: true });
    return pathToFileURL(file).href;
  }
  async dispose(): Promise<void> { this.#disposed = true; this.#epoch++; const directory = await this.#directory?.catch(() => undefined); if (directory) await rm(directory, { recursive: true, force: true }); }
}
