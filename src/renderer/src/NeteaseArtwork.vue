<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { Disc3, ImageOff } from '@lucide/vue';
import { requestNeteaseArtwork } from './netease-artwork';

const props = defineProps<{ id: string; kind: 'playlist' | 'track'; generation: number; name: string }>();
const root = ref<HTMLElement>();
const artwork = ref<string | null>(null);
const status = ref<'loading' | 'ready' | 'missing'>('loading');
let observer: IntersectionObserver | undefined;
let sequence = 0;
let visible = false;
let disposed = false;
async function load(): Promise<void> {
  const current = ++sequence;
  artwork.value = null; status.value = 'loading';
  if (!visible || disposed) return;
  const data = await requestNeteaseArtwork({ id: props.id, kind: props.kind, generation: props.generation });
  if (current !== sequence || disposed) return;
  artwork.value = data; status.value = data ? 'ready' : 'missing';
}
watch(() => [props.id, props.kind, props.generation], () => { void load(); });
onMounted(() => {
  observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) { visible = true; observer?.disconnect(); void load(); }
  }, { rootMargin: '160px' });
  if (root.value) observer.observe(root.value);
});
onUnmounted(() => { disposed = true; sequence++; observer?.disconnect(); });
</script>

<template>
  <span ref="root" class="netease-artwork" :class="`artwork-${status}`" :aria-busy="status === 'loading'">
    <img v-if="artwork" :src="artwork" :alt="`${name}封面`" decoding="async" @error="artwork = null; status = 'missing'" />
    <span v-else class="artwork-fallback" :aria-label="status === 'missing' ? `${name}暂无可用封面` : `${name}封面加载中`" role="img">
      <i aria-hidden="true"></i><Disc3 :size="30" :stroke-width="1.1" aria-hidden="true" />
      <ImageOff v-if="status === 'missing'" class="artwork-unavailable-icon" :size="13" aria-hidden="true" />
    </span>
  </span>
</template>

<style>
.netease-artwork { display: block; position: relative; width: 100%; height: 100%; overflow: hidden; border-radius: inherit; background: var(--canvas); }
.netease-artwork img { width: 100%; height: 100%; display: block; object-fit: cover; }
.artwork-fallback { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); background: radial-gradient(circle at 20% 20%, #d08f9f22, transparent 70%), var(--glass); }
.artwork-fallback i { position: absolute; width: 60%; aspect-ratio: 1; border: 1px solid var(--line); border-radius: 50%; box-shadow: 0 0 0 13px #9e9eb508, 0 0 0 26px #9e9eb508; }
.artwork-unavailable-icon { position: absolute; right: 8px; bottom: 8px; opacity: .7; }
.artwork-loading .artwork-fallback { animation: artwork-breathe 1.6s ease-in-out infinite alternate; }
@keyframes artwork-breathe { to { opacity: .45; } }
.playlist-art:has(.netease-artwork)::before { display: none; }
.playlist-art > .netease-artwork { position: absolute; inset: 0; }
.playlist-detail-art:has(.netease-artwork) { padding: 0; overflow: hidden; }
.song-tile:has(.netease-artwork) { padding: 0; overflow: hidden; }
@media (prefers-reduced-motion: reduce) { .artwork-loading .artwork-fallback { animation: none; } }
</style>
