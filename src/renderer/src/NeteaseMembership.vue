<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Crown, RefreshCw } from '@lucide/vue';
import type { NeteaseMembership } from '../../../packages/contracts/src/netease-rights';
const props = defineProps<{ membership: NeteaseMembership }>();
defineEmits<{ refresh: [] }>();
const names = { vip: '黑胶 VIP', svip: 'SVIP', 'music-package': '音乐包', album: '数字专辑权益' };
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { timer = setInterval(() => { now.value = Date.now(); }, 30_000); });
onUnmounted(() => { clearInterval(timer); });
const active = computed(() => props.membership.benefits.filter(item => item.expiresAt > now.value));
const label = computed(() => props.membership.status === 'loading' ? '正在同步官方权益' : props.membership.status === 'error' ? '权益同步失败' : props.membership.status !== 'ready' ? '权益待同步' : active.value.length ? [...new Set(active.value.map(item => names[item.kind]))].join(' · ') : '当前无有效会员套餐');
const details = computed(() => active.value.map(item => `${names[item.kind]}有效期至 ${new Date(item.expiresAt).toLocaleDateString('zh-CN')}`).join('；'));
</script>
<template>
  <div class="netease-membership" :class="{ 'membership-active': active.length && membership.status === 'ready' }" aria-label="网易云官方会员权益">
    <span :title="details"><Crown :size="15" /><strong>{{ label }}</strong></span>
    <small v-if="membership.status === 'error'" role="status">{{ membership.error?.message }}</small>
    <small v-else-if="membership.error" role="status">单曲权限刷新失败，请重试</small>
    <small v-else>单曲权限以官方实际返回为准</small>
    <button class="text-button" :disabled="membership.status === 'loading'" :aria-busy="membership.status === 'loading'" @click="$emit('refresh')"><RefreshCw :size="13" />同步权益</button>
  </div>
</template>
<style>
.netease-membership { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 14px; padding: 12px 0; margin: -10px 0 20px; color: var(--muted); border-bottom: 1px solid var(--line); }
.netease-membership > span { display: flex; align-items: center; gap: 7px; font-size: 11px; }
.netease-membership strong { font-weight: 500; }
.netease-membership.membership-active > span { color: var(--rose); }
.netease-membership > small { font-size: 10px; line-height: 1.8; }
.netease-membership > button { margin-left: auto; font-size: 10px; min-height: 44px; }
.account-card .netease-membership { margin: 12px 0; }
</style>
