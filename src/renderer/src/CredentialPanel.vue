<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { CredentialsApi, CredentialStatus } from '../../../packages/contracts/src/credentials';

const status = ref<CredentialStatus>();
const error = ref('');
let unsubscribe: (() => void) | undefined;
const providerLabels = { netease: '网易云', kugou: '酷狗' } as const;

function receive(next: CredentialStatus): void { status.value = next; }
async function action(run: (api: CredentialsApi) => Promise<CredentialStatus>): Promise<void> {
  error.value = '';
  try {
    if (!window.starsMusic) throw new Error('bridge unavailable');
    receive(await run(window.starsMusic.credentials));
  } catch { error.value = '保存设置失败，请重试。'; }
}
function changeRemember(event: Event): void {
  const input = event.target as HTMLInputElement;
  void action((api) => api.setRemember(input.checked)).finally(() => {
    input.checked = status.value?.remembered ?? false;
  });
}
onMounted(() => {
  if (!window.starsMusic) return;
  unsubscribe = window.starsMusic.credentials.onChanged(receive);
  void action((api) => api.getStatus());
});
onUnmounted(() => { unsubscribe?.(); status.value = undefined; });
</script>

<template>
  <section class="credential-panel" aria-labelledby="credential-title">
    <div class="runtime-heading">
      <div>
        <h2 id="credential-title">登录保存</h2>
        <p>使用系统密钥保护已登录凭据；不保存密码或二维码。</p>
      </div>
      <button v-if="status && (status.savedProviders.length > 0 || status.locked)" :disabled="!status" @click="action((api) => api.clear())">清除已保存登录</button>
    </div>
    <template v-if="status">
      <label class="remember-toggle">
        <input type="checkbox" :checked="status.remembered" :disabled="!status.available || status.locked" @change="changeRemember" />
        <span>记住登录（应用重启后自动验证）</span>
      </label>
      <p v-if="!status.available" class="provider-note">系统密钥服务不可用（{{ status.backend }}）。当前仅使用临时会话，凭据不会写入磁盘。</p>
      <p v-else-if="status.locked" class="playback-error" role="alert">已保存的登录无法解密，请重新登录或清除保存。</p>
      <p v-else-if="status.remembered" class="provider-note">已启用。凭据由系统密钥加密保存在本机；退出应用后仍保留，退出对应平台或清除保存会删除。</p>
      <p v-else class="provider-note">未启用。开启后，成功登录的凭据会由系统密钥加密保存；未开启时应用关闭即丢弃。</p>
      <p v-if="status.savedProviders.length > 0" class="provider-note">已保存：{{ status.savedProviders.map((provider) => providerLabels[provider]).join('、') }}。</p>
      <p v-if="error || status.error" class="playback-error" role="alert">{{ error || status.error?.message }}</p>
    </template>
  </section>
</template>
