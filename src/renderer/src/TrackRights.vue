<script setup lang="ts">
import { computed } from 'vue';
import type { NeteaseTrackRights } from '../../../packages/contracts/src/netease-rights';
const props = defineProps<{ rights?: NeteaseTrackRights | undefined }>();
const fee = computed(() => props.rights?.fee === 'vip' ? 'VIP' : props.rights?.fee === 'album' ? '付费专辑' : props.rights?.fee === 'vip-quality' ? 'VIP 音质' : '');
const description = computed(() => props.rights?.fee === 'vip' ? '官方标记为 VIP 歌曲，完整播放取决于当前账号的单曲授权' : props.rights?.fee === 'album' ? '官方标记为付费专辑，VIP 不一定包含该专辑的购买权益' : props.rights?.fee === 'vip-quality' ? '普通音质可能可播，会员音质与下载权益以平台为准' : '平台未提供明确收费类型，不能据此认定免费可播');
const access = computed(() => props.rights?.playback === 'full' ? '完整播放' : props.rights?.playback === 'preview' ? '试听' : props.rights?.playback === 'unavailable' ? '暂不可用' : '');
</script>
<template>
  <span class="track-rights">
    <span v-if="fee" class="track-fee" :class="`fee-${rights?.fee}`" :title="description" :aria-label="description">{{ fee }}</span>
    <span v-if="access" class="track-access" :class="`access-${rights?.playback}`" :title="rights?.playback === 'full' ? '官方取链已返回完整播放资源，音频播放状态见播放器' : rights?.playback === 'preview' ? '官方取链仅返回试听资源，将按官方试听范围停止' : '平台版权或当前账号权限暂不允许播放'">{{ access }}</span>
    <span v-if="!fee && (!rights || rights.fee === 'unknown') && !access" class="track-access" :title="description">权限待确认</span>
  </span>
</template>
<style>
.track-rights { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 5px; margin-top: 7px; font-size: 9px; line-height: 1.4; font-weight: 400; }
.track-fee { padding: 2px 5px; border: 1px solid color-mix(in srgb, var(--rose) 35%, transparent); border-radius: 5px; color: var(--rose); background: color-mix(in srgb, var(--rose) 6%, transparent); white-space: nowrap; }
.fee-vip-quality { color: var(--blue); border-color: color-mix(in srgb, var(--blue) 35%, transparent); background: color-mix(in srgb, var(--blue) 6%, transparent); }
.track-access { color: var(--muted); font-size: 9px; white-space: nowrap; }
.access-preview { color: var(--rose); }
.access-full { color: var(--accent); }
.access-unavailable { color: var(--muted); }
</style>
