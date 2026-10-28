<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowLeft, ArrowRight, AudioLines, ListMusic, Music2 } from '@lucide/vue';
import { adjacentIndex, type PlaybackSnapshot, type QueueTrack } from '../../../packages/contracts/src/playback';
import type { PresentationSnapshot } from '../../../packages/contracts/src/presentation';
import { providerNames } from './useProvider';
import TrackLyrics from './TrackLyrics.vue';
import defaultArtwork from './assets/stars-night.png';
const props = defineProps<{
  playback: PlaybackSnapshot;
  track: QueueTrack | undefined;
  presentation: PresentationSnapshot | undefined;
  artwork: string | undefined;
  album: string | undefined;
  status: string;
  backLabel: string;
}>();
defineEmits<{ back: []; queue: [] }>();
const failed = ref(false);
watch(
  () => props.artwork,
  () => {
    failed.value = false;
  },
);
const cover = computed(() => (props.artwork && !failed.value ? props.artwork : defaultArtwork));
const next = computed(() => {
  const index = props.playback.loopMode === 'track' ? props.playback.currentIndex : adjacentIndex(props.playback, 1);
  return props.playback.queue[index ?? -1];
});
</script>
<template>
  <section class="now-playing-page" :class="{ 'has-track': !!track }" aria-label="正在播放">
    <div class="np-atmosphere" aria-hidden="true"><img :src="cover" alt="" /></div>
    <header class="np-page-header">
      <button class="text-button np-back" @click="$emit('back')">
        <ArrowLeft :size="17" />返回{{ backLabel }}
      </button>
      <span class="eyebrow"><AudioLines :size="15" />正在聆听</span>
      <button class="subtle-button compact" @click="$emit('queue')">
        <ListMusic :size="16" />播放队列
        <span class="np-queue-count">{{ playback.queue.length }}</span>
      </button>
    </header>
    <div v-if="track" class="np-layout">
      <div class="np-record-pane">
        <div class="np-record-art">
          <img
            :src="cover"
            :alt="artwork && !failed ? '当前歌曲专辑封面' : 'StarsMusic 原创星夜山景，默认播放背景'"
            @error="failed = true"
          /><span class="np-cover-mark" aria-hidden="true"><AudioLines :size="19" /></span>
        </div>
        <div class="np-track-meta">
          <div class="np-source">
            <span>{{ providerNames[track.provider ?? 'local'] }}</span
            ><span class="np-status" :class="{ live: playback.status === 'playing' }"
              ><i></i>{{ status }}</span
            >
          </div>
          <h1 id="playing-title" tabindex="-1">{{ track.title }}</h1>
          <p class="np-artist">{{ track.artist || '未知歌手' }}</p>
          <p v-if="album" class="np-album">{{ album }}</p>
          <span v-if="track.detail" class="quality-label">{{ track.detail }}</span>
        </div>
      </div>
      <div class="np-lyric-pane">
        <TrackLyrics
          :presentation="presentation"
          :position-seconds="playback.positionSeconds"
          :generation="playback.generation"
          :track-id="track.id"
        />
      </div>
    </div>
    <div v-else class="np-empty">
      <div class="np-empty-symbol" aria-hidden="true"><Music2 :size="48" :stroke-width="1.3" /></div>
      <h1 tabindex="-1">还没有正在播放的音乐</h1>
      <p>从本地音乐或你的歌单中，选一首喜欢的。</p>
      <button class="primary-button" @click="$emit('back')"><Music2 :size="17" />去选首歌</button>
    </div>
    <button v-if="track" class="np-next" @click="$emit('queue')">
      <span class="np-next-label"><ListMusic :size="18" />接下来</span>
      <span class="np-next-copy"
        ><strong>{{ next?.title ?? '当前是队列最后一首' }}</strong
        ><small>{{
          next ? next.artist || providerNames[next.provider ?? 'local'] : '打开队列，管理本次聆听'
        }}</small></span
      >
      <ArrowRight :size="18" />
    </button>
  </section>
</template>
