<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { Volume1, Volume2, VolumeX } from '@lucide/vue';
const props = defineProps<{ volume: number; muted: boolean; send: (value: number) => Promise<boolean>; mute: (value: boolean) => Promise<boolean> }>();
const draft = ref<number | null>(null);
let pending: number | null = null; let sending = false; let disposed = false;
let timer: ReturnType<typeof setTimeout> | undefined;
async function flush(): Promise<void> {
  clearTimeout(timer); timer = undefined;
  if (sending || pending === null || disposed) return;
  sending = true;
  while (pending !== null && !disposed) {
    const value = pending; pending = null;
    await props.send(value);
  }
  sending = false;
  if (!disposed && pending === null) draft.value = null;
}
function change(value: number, immediate = false): void {
  draft.value = Math.max(0, Math.min(100, Math.round(value))); pending = draft.value;
  if (immediate) void flush(); else if (!timer && !sending) timer = setTimeout(() => { void flush(); }, 35);
}
function input(event: Event): void { change(Number((event.target as HTMLInputElement).value)); }
function wheel(event: WheelEvent): void { change((draft.value ?? props.volume) + (event.deltaY < 0 ? 2 : -2), true); }
onUnmounted(() => { disposed = true; clearTimeout(timer); });
</script>
<template>
  <div class="volume-control" aria-label="音量控制">
    <button class="icon-button volume-mute" :aria-label="muted || volume === 0 ? '取消静音' : '静音'" :aria-pressed="muted" :title="muted || volume === 0 ? '取消静音' : '静音'" @click="mute(!(muted || volume === 0))"><VolumeX v-if="muted || (draft ?? volume) === 0" :size="18" /><Volume1 v-else-if="(draft ?? volume) < 50" :size="18" /><Volume2 v-else :size="18" /></button>
    <input aria-label="音量" type="range" min="0" max="100" step="1" :value="draft ?? volume" :aria-valuetext="`${draft ?? volume}%，${muted ? '已静音' : '音量'}`" :style="{ '--range-progress': `${draft ?? volume}%` }" @input="input" @change="flush" @wheel.prevent="wheel" />
    <output aria-hidden="true">{{ Math.round(draft ?? volume) }}</output>
  </div>
</template>
<style>
.volume-control { gap: 7px; }
.volume-control .volume-mute { min-width: 36px; min-height: 44px; padding: 8px; }
.volume-control input[type='range'] { width: clamp(78px, 7vw, 112px); height: 44px; }
.volume-control input[type='range']::-webkit-slider-runnable-track { height: 4px; }
.volume-control input[type='range']::-webkit-slider-thumb { width: 15px; height: 15px; margin-top: -5.5px; box-shadow: 0 2px 8px #0002; }
.volume-control output { min-width: 24px; color: var(--muted); font-size: 10px; font-variant-numeric: tabular-nums; text-align: right; }
.player-tools { gap: 12px; }
</style>
