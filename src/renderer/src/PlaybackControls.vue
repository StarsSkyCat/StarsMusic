<script setup lang="ts">
import { computed, ref } from 'vue';
import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Square } from '@lucide/vue';
import { adjacentIndex, type PlaybackApi, type PlaybackSnapshot } from '../../../packages/contracts/src/playback';
import { formatTime } from './music-ui';
const props = defineProps<{ playback: PlaybackSnapshot }>();
const emit = defineEmits<{
  control: [action: (api: PlaybackApi) => Promise<PlaybackSnapshot>];
}>();
const draft = ref<number | null>(null);
const modeLabel = computed(() => props.playback.shuffle ? '随机播放' : props.playback.loopMode === 'track' ? '单曲循环' : '列表循环');
function cycleMode(): void {
  const mode = props.playback.shuffle ? 'track' : props.playback.loopMode === 'track' ? 'playlist' : 'shuffle';
  emit('control', api => api.setMode(mode));
}
function seek(event: Event): void {
  emit('control', (api) => api.seek(Number((event.target as HTMLInputElement).value)));
  draft.value = null;
}
</script>

<template>
  <div class="playback-controls">
    <div class="transport">
      <button
        class="icon-button"
        aria-label="上一首"
        :disabled="adjacentIndex(playback, -1) === null"
        @click="emit('control', api => api.previous())"
      >
        <SkipBack :size="19" />
      </button>
      <button
        v-if="playback.status === 'playing'"
        class="play-button"
        aria-label="暂停"
        @click="emit('control', (api) => api.pause())"
      >
        <Pause :size="21" fill="currentColor" />
      </button>
      <button
        v-else
        class="play-button"
        aria-label="播放"
        :disabled="playback.queue.length === 0 || playback.status === 'loading'"
        @click="
          emit('control', (api) =>
            playback.currentIndex === null ? api.playTrack(playback.queue[0]!.id) : api.resume(),
          )
        "
      >
        <Play :size="21" fill="currentColor" />
      </button>
      <button
        class="icon-button"
        aria-label="下一首"
        :disabled="adjacentIndex(playback, 1) === null"
        @click="emit('control', api => api.next())"
      >
        <SkipForward :size="19" />
      </button>
      <button class="icon-button playback-mode" :aria-label="modeLabel" :title="`${modeLabel}：点击切换列表循环、随机播放、单曲循环`" @click="cycleMode"><Shuffle v-if="playback.shuffle" :size="17" /><Repeat1 v-else-if="playback.loopMode === 'track'" :size="17" /><Repeat v-else :size="17" /></button>
      <button
        class="icon-button stop-button"
        aria-label="停止"
        :disabled="playback.currentIndex === null"
        @click="emit('control', (api) => api.stop())"
      >
        <Square :size="13" />
      </button>
    </div>
    <div class="seek-control">
      <span>{{ formatTime(draft ?? playback.positionSeconds) }}</span
      ><input
        aria-label="播放进度"
        type="range"
        min="0"
        :max="playback.durationSeconds || 1"
        step="0.1"
        :value="draft ?? playback.positionSeconds"
        :disabled="!['playing', 'paused'].includes(playback.status)"
        :style="{
          '--range-progress': `${((draft ?? playback.positionSeconds) / (playback.durationSeconds || 1)) * 100}%`,
        }"
        @input="draft = Number(($event.target as HTMLInputElement).value)"
        @change="seek"
        @blur="draft = null"
      /><span>{{ formatTime(playback.durationSeconds) }}</span>
    </div>
  </div>
</template>
