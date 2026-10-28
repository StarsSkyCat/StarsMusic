<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { CredentialStatus } from '../../../packages/contracts/src/credentials';
import { ChevronDown, Link2, LogOut, RefreshCw, UserRound, X } from '@lucide/vue';
import { loginLabels, providerNames, type Provider, type ProviderSnapshot } from './useProvider';
import { membershipLabel } from './membership-label';

const props = defineProps<{ provider: Provider; state: ProviderSnapshot; error: string; credentials: CredentialStatus | undefined; saving: boolean }>();
defineEmits<{ login: []; cancel: []; logout: []; remember: [value: boolean]; refreshMembership: [] }>();
const pending = ['loading-qr', 'waiting-scan', 'awaiting-confirmation', 'verifying'];
const open = ref(pending.includes(props.state.status)); const root = ref<HTMLElement>(); const trigger = ref<HTMLButtonElement>();
const popupHeight = ref(360);
const now = ref(Date.now()); let timer: ReturnType<typeof setInterval> | undefined;
const badge = computed(() => membershipLabel(props.provider, props.state, now.value));
const connected = computed(() => props.state.status === 'connected');
const popupId = computed(() => `${props.provider}-account-popup`);
function close(focus = false): void { open.value = false; if (focus) trigger.value?.focus(); }
function outside(event: PointerEvent): void { if (event.target instanceof Node && !root.value?.contains(event.target)) close(); }
function escape(event: KeyboardEvent): void { if (open.value && event.key === 'Escape') { event.preventDefault(); close(true); } }
function fitPopup(): void {
  const bottom = root.value?.closest('main')?.getBoundingClientRect().bottom;
  const anchor = trigger.value?.getBoundingClientRect().bottom;
  if (bottom !== undefined && anchor !== undefined) popupHeight.value = Math.max(120, Math.min(560, bottom - anchor - 20));
}
watch(open, async value => { if (value) { await nextTick(); fitPopup(); } });
watch(() => props.state.status, (status, previous) => {
  if (pending.includes(status) && !pending.includes(previous)) open.value = true;
  else if ((status === 'connected' && previous !== 'connected') || (previous === 'connected' && status !== 'connected')) close();
});
onMounted(() => {
  timer = setInterval(() => { now.value = Date.now(); }, 30_000);
  document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
  window.addEventListener('resize', fitPopup); fitPopup();
});
onUnmounted(() => {
  clearInterval(timer); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);
  window.removeEventListener('resize', fitPopup);
});
</script>

<template>
  <div ref="root" class="provider-account" :class="provider">
    <button ref="trigger" class="ne-account provider-account-trigger" :aria-label="`${providerNames[provider]}账号：${state.account?.nickname ?? loginLabels[state.status]}`" :aria-description="loginLabels[state.status]" :aria-expanded="open" :aria-controls="popupId" aria-haspopup="dialog" @click="open = !open">
      <UserRound :size="16" />
      <span class="account-nickname">{{ state.account?.nickname ?? '登录账号' }}</span>
      <span class="account-status-dot" :class="{ connected }" :title="loginLabels[state.status]" aria-hidden="true"></span>
      <small v-if="badge.label" class="account-vip" :title="badge.detail" :aria-label="badge.detail">{{ badge.label }}</small>
      <ChevronDown :size="13" />
    </button>
    <section v-if="open" :id="popupId" class="provider-account-popup" :style="{ maxHeight: `${popupHeight}px` }" role="dialog" :aria-label="`${providerNames[provider]}账号`">
      <div class="account-popup-heading"><strong>{{ state.account?.nickname ?? providerNames[provider] }}</strong><button class="icon-button" aria-label="关闭账号面板" @click="close(true)"><X :size="15" /></button></div>
      <p class="account-popup-status">{{ loginLabels[state.status] }}<template v-if="connected"> · {{ credentials?.savedProviders.includes(provider) ? '已记住登录' : '仅本次登录' }}</template></p>
      <template v-if="connected">
        <div class="account-membership" role="group" :aria-label="`${provider === 'netease' ? '网易云' : '酷狗'}官方会员权益`">
          <small v-if="badge.label" class="account-vip" :title="badge.detail">{{ badge.label }}</small>
          <span v-if="state.membership.status === 'loading'">会员信息同步中…</span>
          <span v-else-if="state.membership.status === 'error'" role="status">{{ badge.label ? '部分会员信息未同步' : '会员信息同步失败' }}</span>
          <span v-else-if="!badge.label">{{ state.membership.status === 'ready' ? '暂无会员标记' : '会员信息待同步' }}</span>
          <button class="text-button" :disabled="state.membership.status === 'loading'" @click="$emit('refreshMembership')"><RefreshCw :size="13" />同步权益</button>
        </div>
        <button class="subtle-button account-logout" @click="$emit('logout')"><LogOut :size="15" />{{ provider === 'netease' ? '退出网易云' : '退出酷狗' }}</button>
      </template>
      <template v-else>
        <div v-if="state.qrImage" class="account-qr">
          <img :src="state.qrImage" width="184" height="184" :alt="`${providerNames[provider]} App 扫码登录二维码`" draggable="false" />
          <p>{{ provider === 'kugou' ? '使用标准版酷狗音乐 App 扫码' : '使用网易云音乐 App 扫码' }}，仅在官方 App 中确认授权。</p>
        </div>
        <div v-if="pending.includes(state.status)" class="login-preference">
          <label class="remember-toggle"><input type="checkbox" :aria-label="`记住${providerNames[provider]}登录`" :checked="credentials?.rememberedProviders.includes(provider) ?? false" :disabled="saving || !credentials?.available || credentials.locked" @change="$emit('remember', ($event.target as HTMLInputElement).checked)" /><span>记住登录</span></label>
          <p>退出登录会自动删除保存。</p>
          <p v-if="credentials && (!credentials.available || credentials.locked)" role="alert">本地保存暂不可用，可继续临时登录。</p>
          <button class="subtle-button" @click="$emit('cancel')"><X :size="15" />取消授权</button>
        </div>
        <button v-else class="primary-button" @click="$emit('login')"><Link2 :size="16" />{{ provider === 'netease' ? '连接网易云' : '连接酷狗' }}</button>
        <button v-if="credentials?.savedProviders.includes(provider)" class="text-button account-logout" @click="$emit('logout')"><LogOut :size="15" />退出并删除本机登录</button>
      </template>
      <p v-if="error || state.error || credentials?.error" class="error-message" role="alert">{{ error || state.error?.message || credentials?.error?.message }}</p>
    </section>
  </div>
</template>

<style scoped>
.provider-account { position: relative; flex-shrink: 0; max-width: 50%; }
.provider-account-trigger { max-width: 100%; gap: 7px; }
.provider-account-trigger .account-nickname { max-width: 18ch; }
.account-status-dot { flex-shrink: 0; width: 5px; height: 5px; border-radius: 50%; background: var(--muted); }
.account-status-dot.connected { background: var(--success); }
.account-vip { display: inline-flex; align-items: center; flex-shrink: 0; padding: 2px 5px; border-radius: 4px; font-size: 9px; line-height: 1.25; font-weight: 650; letter-spacing: .3px; color: var(--rose); background: color-mix(in srgb, var(--rose) 10%, transparent); }
.kugou .account-vip { color: var(--blue); background: color-mix(in srgb, var(--blue) 10%, transparent); }
.provider-account-popup { position: absolute; right: 0; top: calc(100% + 9px); z-index: 30; width: 310px; max-width: calc(100vw - 80px); max-height: min(560px, 65vh); overflow-y: auto; padding: 16px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); color: var(--text); box-shadow: var(--shadow); }
.account-popup-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.account-popup-heading strong { min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
.account-popup-heading button { flex-shrink: 0; }
.provider-account-popup .account-popup-status { margin: 2px 0 14px; font-size: 11px; color: var(--muted); }
.account-membership { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 11px; color: var(--muted); }
.account-membership button { margin-left: auto; font-size: 11px; }
.account-logout { width: 100%; margin-top: 8px; }
.account-qr { text-align: center; }
.account-qr img { display: block; margin: 0 auto; padding: 8px; box-sizing: content-box; border-radius: 12px; background: #fff; }
.provider-account-popup .account-qr p { margin: 10px 0; font-size: 11px; line-height: 1.7; }
.provider-account-popup .login-preference p { margin: 8px 0; font-size: 11px; }
@media (max-width: 1050px) { .provider-account-trigger { padding: 9px 10px; } .provider-account-trigger .account-nickname { max-width: 12ch; } }
</style>
