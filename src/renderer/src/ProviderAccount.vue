<script setup lang="ts">
import type { CredentialStatus } from '../../../packages/contracts/src/credentials';
import { Check, Cloud, Link2, LogOut, X } from '@lucide/vue';
import { loginLabels, providerNames, type Provider, type ProviderSnapshot } from './useProvider';

defineProps<{ provider: Provider; state: ProviderSnapshot; error: string; credentials: CredentialStatus | undefined; saving: boolean }>();
defineEmits<{ login: []; cancel: []; logout: []; remember: [value: boolean] }>();
const pending = ['loading-qr', 'waiting-scan', 'awaiting-confirmation', 'verifying'];
const diagnostics = {
  'authorization-userid': '授权响应缺少有效账号 ID',
  'authorization-token': '授权凭据格式不受支持',
  'account-request': '账号信息请求未通过校验',
  'profile-userid': '账号信息缺少有效 ID',
  'profile-mismatch': '授权账号与账号信息不一致',
  'profile-nickname': '账号信息缺少昵称',
};
</script>

<template>
  <section class="account-card" :class="provider" :aria-label="providerNames[provider]">
    <div class="section-heading">
      <div class="account-heading">
        <span class="source-icon"><Cloud :size="23" /></span>
        <div>
          <h2>{{ providerNames[provider] }}</h2>
          <p>{{ state.account?.nickname ?? loginLabels[state.status] }}</p>
        </div>
      </div>
      <span v-if="state.status === 'connected'" class="connected-badge"
        ><Check :size="13" /> 已连接</span
      >
    </div>
    <div v-if="state.qrImage" class="qr-login">
      <img
        :src="state.qrImage"
        width="184"
        height="184"
        :alt="`${providerNames[provider]} App 扫码登录二维码`"
        draggable="false"
      />
      <div>
        <strong>{{ loginLabels[state.status] }}</strong>
        <p>
          {{
            provider === 'kugou'
              ? '请使用标准版酷狗音乐 App 扫码。'
              : '请使用网易云音乐 App 扫码。'
          }}仅在官方 App 中确认授权。
        </p>
        <p>二维码过期后重新获取，请勿保存或分享。</p>
      </div>
    </div>
    <p v-else class="account-description">
      {{
        state.status === 'connected'
          ? '歌单已连接到你的音乐空间。播放权限以平台实际返回为准。'
          : '连接你的账号，把熟悉的歌单带到这里。扫码时可选择记住登录。'
      }}
    </p>
    <div v-if="pending.includes(state.status)" class="login-preference">
      <label class="remember-toggle">
        <input type="checkbox" :aria-label="`记住${providerNames[provider]}登录`" :checked="credentials?.rememberedProviders.includes(provider) ?? false" :disabled="saving || !credentials?.available || credentials.locked" @change="$emit('remember', ($event.target as HTMLInputElement).checked)" />
        <span>记住登录</span>
      </label>
      <p>勾选后在本机保存，下次打开自动验证。退出账号会删除保存。</p>
      <p v-if="credentials && !credentials.available" role="alert">本地保存暂不可用，可继续临时登录。</p>
    </div>
    <p v-if="state.status === 'connected'" class="login-saved-note">{{ credentials?.savedProviders.includes(provider) ? '已记住登录 · 退出账号会删除保存' : '仅本次登录 · 下次需重新扫码' }}</p>
    <p v-if="error || state.error" class="error-message" role="alert">
      {{ error || state.error?.message
      }}<span v-if="'loginDiagnostic' in state && state.loginDiagnostic"
        >（{{ diagnostics[state.loginDiagnostic] }}）</span
      >
    </p>
    <button v-if="state.status === 'connected'" class="subtle-button" @click="$emit('logout')">
      <LogOut :size="15" />{{ provider === 'netease' ? '退出网易云' : '退出酷狗' }}
    </button>
    <button
      v-else-if="pending.includes(state.status)"
      class="subtle-button"
      @click="$emit('cancel')"
    >
      <X :size="15" />取消授权
    </button>
    <button v-else class="subtle-button" @click="$emit('login')">
      <Link2 :size="15" />{{ provider === 'netease' ? '连接网易云' : '连接酷狗' }}
    </button>
  </section>
</template>
