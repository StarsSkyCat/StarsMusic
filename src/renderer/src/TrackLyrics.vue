<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
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
watch(
  [current, lyrics],
  async () => {
    await nextTick();
    const row = rows.value?.querySelector<HTMLElement>('[aria-current="true"]');
    if (row && rows.value)
      rows.value.scrollTo({
        top: Math.max(
          0,
          row.offsetTop - rows.value.offsetTop - rows.value.clientHeight / 2 + row.clientHeight / 2,
        ),
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
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
