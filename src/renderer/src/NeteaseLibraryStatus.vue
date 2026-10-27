<script setup lang="ts">
import { RefreshCw } from '@lucide/vue';
import type { NeteaseLibrary } from '../../../packages/contracts/src/netease-library';
defineProps<{ library: NeteaseLibrary }>();
defineEmits<{ refresh: [] }>();
</script>
<template>
  <div class="ne-library-status">
    <span v-if="library.busy" role="status">正在同步网易云收藏…</span><span v-else-if="library.likesStatus === 'loading'" role="status">正在读取喜欢的歌曲…</span><span v-else-if="library.unconfirmed" role="alert">写入结果尚未确认，请刷新后核对。</span><span v-else-if="library.likesStatus === 'error'" role="status">喜欢列表未读取，可刷新重试。</span><span v-else-if="library.error" role="status">{{ library.error.message }}</span><span v-else>喜欢、歌单与网易云账号同步</span>
    <button class="text-button" :disabled="library.busy" @click="$emit('refresh')"><RefreshCw :size="12" />刷新收藏</button>
  </div>
</template>
<style>
.ne-library-status { display: flex; align-items: center; justify-content: space-between; gap: 15px; margin: -12px 0 14px; color: var(--muted); font-size: 10px; line-height: 1.8; }
.ne-library-status button { min-height: 44px; font-size: 10px; }
.playlist-detail-heading + .ne-library-status { margin-top: 0; }
</style>
