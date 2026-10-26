import { onMounted, onUnmounted, reactive, ref, shallowRef } from 'vue';
import type { CredentialProvider, CredentialStatus } from '../../../packages/contracts/src/credentials';

export function useCredentials() {
  const status = shallowRef<CredentialStatus>();
  const busy = reactive({ netease: false, kugou: false });
  const error = ref('');
  let unsubscribe: (() => void) | undefined;
  function receive(next: CredentialStatus): void {
    if (!status.value || next.revision >= status.value.revision) status.value = next;
  }
  async function setRemember(provider: CredentialProvider, remember: boolean): Promise<void> {
    busy[provider] = true; error.value = '';
    try {
      if (!window.starsMusic) throw new Error('bridge unavailable');
      receive(await window.starsMusic.credentials.setRemember(provider, remember));
    } catch { error.value = '登录保存设置失败，请重试。'; }
    finally { busy[provider] = false; }
  }
  async function clear(): Promise<void> {
    error.value = '';
    try {
      if (!window.starsMusic) throw new Error('bridge unavailable');
      receive(await window.starsMusic.credentials.clear());
    } catch { error.value = '清除已保存登录失败，请重试。'; }
  }
  onMounted(() => {
    if (!window.starsMusic) return;
    unsubscribe = window.starsMusic.credentials.onChanged(receive);
    void window.starsMusic.credentials.getStatus().then(receive).catch(() => { error.value = '暂时无法读取登录保存状态。'; });
  });
  onUnmounted(() => unsubscribe?.());
  return { status, busy, error, setRemember, clear };
}
