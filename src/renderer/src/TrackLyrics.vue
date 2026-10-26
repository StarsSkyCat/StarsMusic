<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import {
  activeLyricIndex,
  type PresentationSnapshot,
} from '../../../packages/contracts/src/presentation';
const props = defineProps<{
  presentation: PresentationSnapshot | undefined;
  positionSeconds: number;
  generation: number;
  trackId: string | undefined;
}>();
const rows = ref<HTMLElement>();
const valid = computed(() =>
  props.presentation?.generation === props.generation &&
  props.presentation?.trackId === props.trackId
    ? props.presentation
    : undefined,
);
const lyrics = computed(() => valid.value?.content?.lyrics ?? []);
const current = computed(() => activeLyricIndex(lyrics.value, props.positionSeconds));
let resizeObserver: ResizeObserver | undefined;

function centerCurrent(behavior: ScrollBehavior): void {
  const container = rows.value;
  const row = container?.querySelector<HTMLElement>('[aria-current="true"]');
  if (row && container)
    container.scrollTo({
      top: Math.max(0, container.scrollTop + row.getBoundingClientRect().top
        - container.getBoundingClientRect().top - container.clientHeight / 2 + row.clientHeight / 2),
      behavior,
    });
}

watch(rows, (container) => {
  resizeObserver?.disconnect();
  const viewport = container?.parentElement;
  if (!container || !viewport) return;
  resizeObserver = new ResizeObserver(() => {
    // 监听外层可用高度，避免歌词留白 padding 反过来撑高被观测元素。
    container.style.setProperty('--lyric-height', `${viewport.clientHeight}px`);
    container.style.setProperty('--lyric-width', `${viewport.clientWidth}px`);
    centerCurrent('instant');
  });
  resizeObserver.observe(viewport);
});
onUnmounted(() => resizeObserver?.disconnect());
watch(
  [current, lyrics],
  async () => {
    await nextTick();
    centerCurrent(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth');
  },
  { immediate: true },
);
</script>
<template>
  <section class="track-lyrics" aria-label="歌词">
    <div v-if="lyrics.length" ref="rows" class="lyric-scroll" tabindex="0" aria-label="滚动歌词">
      <p
        v-for="(line, index) in lyrics"
        :key="`${line.timeMs}:${index}`"
        :aria-current="index === current ? 'true' : undefined"
        :class="{
          'lyric-near': current >= 0 && Math.abs(index - current) === 1,
          'lyric-distant': current >= 0 && Math.abs(index - current) > 2,
        }"
      >
        {{ line.text }}
      </p>
    </div>
    <p v-else class="lyrics-empty">
      {{
        valid?.status === 'loading'
          ? '正在获取歌词…'
          : valid?.content?.lyricsError || valid?.error
            ? '歌词暂时读取失败'
            : '暂无可用歌词'
      }}
    </p>
  </section>
</template>
