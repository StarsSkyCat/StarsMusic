<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Copy, Square, Minus, X } from '@lucide/vue';
import type { WindowSnapshot } from '../../../packages/contracts/src/window';

const state = ref<WindowSnapshot>();
const error = ref('');
const restore = computed(() => state.value?.maximized || state.value?.fullscreen);
let unsubscribe: (() => void) | undefined;
let active = true;
function receive(value: WindowSnapshot): void { if (active) state.value = value; }
async function run(command: 'minimize' | 'toggleMaximize' | 'close'): Promise<void> {
  const api = window.starsMusic?.window;
  if (!api) return;
  error.value = '';
  try {
    if (command === 'close') await api.close();
    else await api[command](); // 图标以主进程事件为准，避免系统异步状态被旧响应覆盖。
  } catch { if (active) error.value = '窗口操作失败，请重试。'; }
}
onMounted(() => {
  const api = window.starsMusic?.window;
  if (!api) return;
  let changed = false;
  unsubscribe = api.onChanged(value => { changed = true; receive(value); });
  void api.getState().then(value => { if (!changed) receive(value); }).catch(() => { error.value = '窗口控制不可用。'; });
});
onUnmounted(() => { active = false; unsubscribe?.(); });
</script>

<template>
  <div v-if="state && state.platform !== 'darwin'" class="window-controls" :class="{ 'is-unfocused': !state.focused }" role="group" aria-label="窗口控制">
    <button type="button" title="最小化" aria-label="最小化窗口" @click="run('minimize')"><Minus :size="16" aria-hidden="true" /></button>
    <button type="button" :title="restore ? '还原' : '最大化'" :aria-label="restore ? '还原窗口' : '最大化窗口'" @click="run('toggleMaximize')"><component :is="restore ? Copy : Square" :size="13" aria-hidden="true" /></button>
    <button type="button" class="window-close" title="关闭" aria-label="关闭窗口" @click="run('close')"><X :size="17" aria-hidden="true" /></button>
    <span v-if="error" class="window-control-error" role="alert">{{ error }}</span>
  </div>
</template>

<style scoped>
.window-controls { position: relative; display: flex; align-items: center; flex-shrink: 0; gap: 2px; -webkit-app-region: no-drag; }
.window-controls button { display: grid; place-items: center; width: 32px; height: 30px; min-height: 30px; padding: 0; border: 0; border-radius: 7px; background: transparent; color: var(--muted); box-shadow: none; -webkit-app-region: no-drag; }
.window-controls button:hover { background: color-mix(in srgb, var(--text) 10%, transparent); color: var(--text); transform: none; }
.window-controls button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.window-controls .window-close:hover { background: #c83c50; color: white; }
.is-unfocused button { opacity: .65; }
.is-unfocused button:hover, .is-unfocused button:focus-visible { opacity: 1; }
.window-control-error { position: absolute; right: 0; top: 36px; width: max-content; padding: 9px 12px; border-radius: 10px; color: var(--text); background: var(--canvas); font-size: 12px; }
</style>
