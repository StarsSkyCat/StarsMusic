<script setup lang="ts">
import { AudioLines, ListPlus, Play, X } from '@lucide/vue';
import { formatTime, type DisplayTrack } from './music-ui';
import { providerNames } from './useProvider';

defineProps<{
  tracks: readonly DisplayTrack[];
  selected: readonly string[];
  currentId?: string | undefined;
  removable?: boolean;
}>();
defineEmits<{
  select: [id: string];
  selectAll: [];
  play: [id: string];
  next: [id: string];
  remove: [id: string];
}>();
</script>

<template>
  <div class="track-table">
    <div class="table-header">
      <input
        aria-label="全选当前列表"
        type="checkbox"
        :checked="tracks.length > 0 && tracks.every((t) => selected.includes(t.id))"
        :indeterminate="selected.length > 0 && !tracks.every((t) => selected.includes(t.id))"
        @change="$emit('selectAll')"
      />
      <span class="row-number">#</span><span class="song-column">歌曲 / 歌手</span
      ><span class="source-column">来源</span><span class="duration-column">时长</span
      ><span class="row-actions">操作</span>
    </div>
    <ol class="song-list">
      <li
        v-for="(track, index) in tracks"
        :key="track.id"
        :class="{
          'is-current': track.id === currentId,
          'is-selected': selected.includes(track.id),
        }"
        @dblclick="$emit('play', track.id)"
      >
        <input
          :aria-label="`选择 ${track.title}`"
          type="checkbox"
          :checked="selected.includes(track.id)"
          @change="$emit('select', track.id)"
        />
        <span class="row-number"
          ><AudioLines v-if="track.id === currentId" :size="16" /><span v-else>{{
            String(index + 1).padStart(2, '0')
          }}</span></span
        >
        <button
          class="song-column song-name"
          :aria-label="`播放 ${track.title}`"
          :aria-current="track.id === currentId ? 'true' : undefined"
          @click="$emit('play', track.id)"
        >
          <strong>{{ track.title }}</strong
          ><small>{{
            track.artist || (track.provider === 'local' ? '本地音频' : '未知歌手')
          }}</small>
        </button>
        <span class="source-column"
          ><span class="source-badge" :class="track.provider">{{
            providerNames[track.provider ?? 'local']
          }}</span></span
        >
        <span class="duration-column">{{
          track.durationSeconds ? formatTime(track.durationSeconds) : '—'
        }}</span>
        <span class="row-actions">
          <button
            class="icon-button"
            :aria-label="`立即播放 ${track.title}`"
            :title="`播放 ${track.title}`"
            @click="$emit('play', track.id)"
          >
            <Play :size="16" />
          </button>
          <button
            class="icon-button"
            :disabled="track.id === currentId"
            :aria-label="`下一首播放 ${track.title}`"
            title="下一首播放"
            @click="$emit('next', track.id)"
          >
            <ListPlus :size="17" />
          </button>
          <button
            v-if="removable"
            class="icon-button"
            :disabled="track.id === currentId"
            :aria-label="`移除 ${track.title}`"
            title="移出队列"
            @click="$emit('remove', track.id)"
          >
            <X :size="15" />
          </button>
        </span>
      </li>
    </ol>
  </div>
</template>
