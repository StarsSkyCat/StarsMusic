<script setup lang="ts">
import TrackRights from './TrackRights.vue';
import { AudioLines, ListPlus, Music2, Play, X } from '@lucide/vue';
import { formatTime, type DisplayTrack } from './music-ui';
import { providerNames } from './useProvider';

defineProps<{
  tracks: readonly DisplayTrack[];
  selected: readonly string[];
  currentId?: string | undefined;
  removable?: boolean;
  rowOffset?: number;
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
            String(index + 1 + (rowOffset ?? 0)).padStart(2, '0')
          }}</span></span
        >
        <button
          class="song-column song-name"
          :aria-label="`播放 ${track.title}`"
          :aria-current="track.id === currentId ? 'true' : undefined"
          @click="$emit('play', track.id)"
        >
          <span class="song-tile" aria-hidden="true"><slot name="artwork" :track="track"><AudioLines v-if="track.id === currentId" :size="19" /><Music2 v-else :size="19" /></slot></span>
          <span class="song-copy"><strong>{{ track.title }}</strong
          ><small>{{
            track.artist || (track.provider === 'local' ? '本地音频' : '未知歌手')
          }}</small><TrackRights v-if="track.provider === 'netease'" :rights="track.rights" /></span>
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
