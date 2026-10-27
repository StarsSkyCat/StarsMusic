import type { NeteaseArtworkRequest } from '../../../packages/contracts/src/netease-artwork';

// 页面只排队请求资源 ID，不保存平台地址。四路请求与后台上限一致。
const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();
const queue: (() => Promise<void>)[] = [];
let active = 0;
let generation = -1;
function drain(): void {
  while (active < 4 && queue.length) {
    active++;
    void queue.shift()!().finally(() => { active--; drain(); });
  }
}
export function requestNeteaseArtwork(request: NeteaseArtworkRequest): Promise<string | null> {
  if (generation !== request.generation) { generation = request.generation; cache.clear(); pending.clear(); }
  const key = `${request.generation}:${request.kind}:${request.id}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = new Promise<string | null>(resolve => {
    queue.push(async () => {
      let artwork: string | null = null;
      try { if (generation === request.generation && window.starsMusic) artwork = await window.starsMusic.netease.getArtwork(request); } catch { /* 图片失败不影响内容和播放。 */ }
      if (generation === request.generation) {
        cache.set(key, artwork);
        while (cache.size > 32) cache.delete(cache.keys().next().value!);
      }
      resolve(generation === request.generation ? artwork : null);
      pending.delete(key);
    });
  });
  pending.set(key, promise); drain();
  return promise;
}
