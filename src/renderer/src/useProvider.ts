import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import {
  initialNeteaseSnapshot,
  type NeteaseApi,
  type NeteaseSnapshot,
} from '../../../packages/contracts/src/netease';
import {
  initialKugouSnapshot,
  type KugouApi,
  type KugouSnapshot,
} from '../../../packages/contracts/src/kugou';

export type Provider = 'netease' | 'kugou';
export type ProviderSnapshot = NeteaseSnapshot | KugouSnapshot;
export const providerNames = {
  local: '本地音乐',
  netease: '网易云音乐',
  kugou: '酷狗音乐',
} as const;
export const loginLabels = {
  'signed-out': '未连接',
  'loading-qr': '正在获取二维码',
  'waiting-scan': '请使用官方 App 扫码',
  'awaiting-confirmation': '请在 App 中确认授权',
  verifying: '正在验证账号',
  connected: '已连接',
  expired: '登录已过期',
  cancelled: '已取消',
  failed: '连接失败',
};

export function useProvider(provider: Provider) {
  const state = shallowRef<ProviderSnapshot>(
    provider === 'netease' ? initialNeteaseSnapshot() : initialKugouSnapshot(),
  );
  const error = ref('');
  let unsubscribe: (() => void) | undefined;
  function receive(next: ProviderSnapshot): void {
    if (next.revision < state.value.revision) return;
    const connected =
      next.status === 'connected' &&
      (state.value.status !== 'connected' || state.value.generation !== next.generation);
    if (next.generation !== state.value.generation) error.value = '';
    state.value = next;
    if (connected) void run((api) => api.loadPlaylists());
  }
  async function run(
    action: (api: NeteaseApi | KugouApi) => Promise<ProviderSnapshot | void>,
  ): Promise<boolean> {
    error.value = '';
    const generation = state.value.generation;
    try {
      if (!window.starsMusic) throw new Error('bridge unavailable');
      const result = await action(window.starsMusic[provider]);
      if (result) receive(result);
      return result ? !result.error : true;
    } catch {
      if (generation === state.value.generation)
        error.value = `${providerNames[provider]}操作失败，请重试。`;
      return false;
    }
  }
  onMounted(() => {
    if (!window.starsMusic) return;
    unsubscribe = window.starsMusic[provider].onStateChanged(receive);
    void run((api) => api.getState());
  });
  onUnmounted(() => unsubscribe?.());
  return { state, error, run };
}
