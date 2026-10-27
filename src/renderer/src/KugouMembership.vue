<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Crown, RefreshCw } from '@lucide/vue';
import type { KugouMembership } from '../../../packages/contracts/src/kugou-rights';
const props = defineProps<{ membership: KugouMembership }>();
defineEmits<{ refresh: [] }>();
const names = { standard: '标准版 VIP', svip: '概念版 VIP', tvip: '畅听 VIP', qvip: 'QVIP 权益', dvip: 'DVIP 权益', other: '其他会员权益' };
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { timer = setInterval(() => { now.value = Date.now(); }, 30_000); });
onUnmounted(() => { clearInterval(timer); });
const active = computed(() => props.membership.benefits.filter(item => (item.expiresAt === undefined || item.expiresAt > now.value) && (item.startsAt === undefined || item.startsAt <= now.value)));
const label = computed(() => props.membership.status === 'loading' ? '正在同步会员权益' : props.membership.status === 'error' ? active.value.length ? '部分权益未同步' : '权益同步失败' : props.membership.status !== 'ready' ? '权益待同步' : active.value.length ? '已同步会员权益' : '当前无有效会员套餐');
function expiry(value: number): string { return new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }); }
</script>
<template>
  <section class="kugou-membership" aria-label="酷狗官方会员权益">
    <div class="kg-membership-summary"><span><Crown :size="15" /><strong>{{ label }}</strong></span><button class="text-button" :disabled="membership.status === 'loading'" :aria-busy="membership.status === 'loading'" @click="$emit('refresh')"><RefreshCw :size="13" />同步权益</button></div>
    <div v-if="active.length" class="kg-membership-benefits"><span v-for="(item, index) in active" :key="index"><strong>{{ names[item.kind] }}</strong><small>{{ item.expiresAt === undefined ? '平台未返回有效期' : `有效期至 ${expiry(item.expiresAt)}` }}</small></span></div>
    <p v-if="membership.status === 'error'" role="status">{{ membership.error?.message }}，可重新同步。</p>
    <p>不同套餐的歌曲、音质权益可能不同，播放以平台实际返回为准。</p>
  </section>
</template>
<style>
.kugou-membership { margin: -10px 0 20px; padding: 0 0 16px; border-bottom: 1px solid var(--line); color: var(--muted); }
.kg-membership-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 11px; }
.kg-membership-summary > span { display: flex; align-items: center; gap: 7px; }
.kg-membership-summary strong { font-weight: 500; }
.kg-membership-summary button { min-height: 44px; font-size: 10px; flex-shrink: 0; }
.kg-membership-benefits { display: flex; flex-wrap: wrap; gap: 8px; margin: 2px 0 12px; }
.kg-membership-benefits > span { display: flex; flex-wrap: wrap; gap: 5px 10px; align-items: baseline; padding: 7px 10px; border-radius: 9px; border: 1px solid color-mix(in srgb, var(--blue) 30%, transparent); background: color-mix(in srgb, var(--blue) 5%, transparent); }
.kg-membership-benefits strong { color: var(--blue); font-size: 11px; font-weight: 500; }
.kg-membership-benefits small, .kugou-membership p { font-size: 10px; line-height: 1.8; }
.account-card .kugou-membership { margin: 12px 0; }
</style>
