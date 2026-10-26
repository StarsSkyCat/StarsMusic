<script setup lang="ts">
import type { CredentialStatus } from '../../../packages/contracts/src/credentials';
import { ShieldCheck } from '@lucide/vue';
defineProps<{ status: CredentialStatus | undefined; error: string }>();
defineEmits<{ clear: [] }>();
const providerLabels = { netease: '网易云', kugou: '酷狗' } as const;
</script>
<template>
  <section class="credential-panel" aria-labelledby="credential-title">
    <div class="runtime-heading">
      <span class="security-symbol" aria-hidden="true"><ShieldCheck :size="25" /></span>
      <div>
        <h2 id="credential-title">登录保存</h2>
        <p>在各平台扫码区域选择「记住登录」。退出账号会自动删除该平台凭据。</p>
      </div>
      <button v-if="status && (status.savedProviders.length || status.locked || !status.available)" class="subtle-button" @click="$emit('clear')">清除已保存登录</button>
    </div>
    <p v-if="status?.savedProviders.length" class="provider-note">已保存：{{ status.savedProviders.map(provider => providerLabels[provider]).join('、') }}。</p>
    <p v-else class="provider-note">尚未保存登录。未勾选时仅用于本次会话，下次登录时可重新选择。</p>
    <p v-if="status?.locked || (status && !status.available)" class="playback-error" role="alert">本地登录存储暂不可用。可继续临时登录，或清除保存后重新扫码。</p>
    <p v-if="error || status?.error" class="playback-error" role="alert">{{ error || status?.error?.message }}</p>
    <details class="credential-security"><summary>本地保存说明</summary><p>凭据在本机加密保存。密钥与数据库分文件存放；同时取得两者即可解密，请勿分享应用数据目录。不保存密码或二维码。</p></details>
  </section>
</template>
