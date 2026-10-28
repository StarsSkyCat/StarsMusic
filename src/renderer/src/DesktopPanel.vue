<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, ref } from 'vue';
import { Monitor, Power, Keyboard } from '@lucide/vue';
import type { SystemSnapshot, SystemPreferenceKey, CapabilityState } from '../../../packages/contracts/src/system';
const state = shallowRef<SystemSnapshot>(); const busy = ref(false); const error = ref('');
let unsubscribe: (() => void) | undefined; let disposed = false;
const labels: Record<CapabilityState, string> = { available: '可用', unavailable: '不可用', unknown: '未确认', pending: '等待授权', disabled: '未启用' };
const windows = computed(() => state.value?.platform === 'win32');
const options = [{ key: 'tray', title: '启用系统托盘', detail: '显示窗口、播放控制和退出入口' }, { key: 'closeToTray', title: '关闭窗口后留在托盘', detail: '请先确认托盘图标可见；宿主不可用时关闭窗口仍会退出' },
  { key: 'notifications', title: '后台切歌通知', detail: '窗口隐藏或最小化时通知新曲目' }, { key: 'globalShortcuts', title: '申请全局快捷键', detail: 'Wayland 需要桌面 portal 确认；关闭可取消申请' }] as const;
function receive(next: SystemSnapshot): void { if (!disposed && (!state.value || next.revision >= state.value.revision)) state.value = next; }
async function run(action: () => Promise<SystemSnapshot>): Promise<void> {
  if (busy.value) return; busy.value = true; error.value = '';
  try { receive(await action()); } catch { error.value = '桌面设置保存失败，请重试。'; } finally { busy.value = false; }
}
async function set(key: SystemPreferenceKey, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement; const enabled = input.checked;
  await run(() => window.starsMusic!.system.setPreference(key, enabled)); input.checked = state.value?.preferences[key] ?? false;
}
function quit(): void { void window.starsMusic!.system.quit().catch(() => { error.value = '退出请求失败，请使用窗口关闭按钮。'; }); }
onMounted(() => {
  if (!window.starsMusic?.system) { error.value = '桌面能力桥接不可用'; return; }
  unsubscribe = window.starsMusic.system.onChanged(receive); void run(() => window.starsMusic!.system.getState());
});
onUnmounted(() => { disposed = true; unsubscribe?.(); });
</script>
<template>
  <section class="desktop-panel" aria-labelledby="desktop-title">
    <div class="desktop-heading"><h2 id="desktop-title"><Monitor :size="20" />桌面设置</h2></div>
    <template v-if="state">
      <fieldset class="desktop-preferences" :disabled="busy"><legend class="sr-only">桌面集成设置</legend><label v-for="option in options" :key="option.key"><input type="checkbox" :checked="state.preferences[option.key]" :disabled="(option.key === 'closeToTray' && state.tray.state !== 'available' && !state.preferences.closeToTray) || (windows && option.key === 'notifications')" @change="set(option.key, $event)" /><span><strong>{{ option.title }}</strong><small>{{ windows && option.key === 'globalShortcuts' ? '按 Windows 实际注册结果启用；快捷键冲突时保留窗口内控制' : windows && option.key === 'notifications' ? state.notifications.detail : windows && option.key === 'closeToTray' ? '请先确认通知区域中能找到 StarsMusic 图标，再开启后台播放' : option.detail }}</small></span></label></fieldset>
      <details class="desktop-shortcuts"><summary><Keyboard :size="16" />快捷键与媒体键</summary><p>以下组合键在窗口内始终可用。全局绑定以桌面实际返回结果为准；{{ windows ? 'Windows 系统媒体面板与专用媒体键尚未接入。' : '媒体键由桌面通过 MPRIS 分发，不重复抢占。' }}</p><ul><li v-for="binding in state.bindings" :key="binding.id"><span>{{ binding.label }}</span><kbd>{{ binding.accelerator.replace('Control', 'Ctrl') }}</kbd><small>{{ binding.trigger || labels[binding.state] }}</small></li></ul></details>
      <div class="desktop-actions"><button class="text-button desktop-quit" @click="quit"><Power :size="15" />退出程序</button></div>
      <p class="desktop-footnote">{{ windows ? '托盘图标可能收起在通知区域的折叠菜单中。默认关闭窗口会退出，启用关闭到托盘后可从图标菜单退出。' : '托盘已提交不代表图标一定可见，通知可能受免打扰影响。Wayland 能力取决于当前桌面和 portal 后端。' }}</p>
    </template>
    <p v-if="error || state?.error" class="error-message" role="alert">{{ error || state?.error?.message }}</p>
  </section>
</template>
<style scoped>
.desktop-panel { margin-bottom: 24px; padding: 26px; border-radius: 24px; border: 1px solid var(--line); background: var(--glass); backdrop-filter: blur(24px); }
.desktop-heading, .desktop-actions, h2 { display: flex; align-items: center; gap: 10px; }
.desktop-heading { justify-content: space-between; gap: 20px; margin-bottom: 20px; } h2 { margin: 8px 0; font-size: 19px; }
.desktop-heading p, .desktop-footnote, .desktop-shortcuts p { color: var(--muted); font-size: 12px; line-height: 1.7; margin: 5px 0; }
.desktop-preferences { border: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; }
.desktop-preferences label { display: flex; align-items: center; gap: 12px; padding: 12px; min-height: 56px; cursor: pointer; } .desktop-preferences strong { display: block; font-size: 12px; } .desktop-preferences small { display: block; color: var(--muted); font-size: 11px; line-height: 1.7; margin-top: 5px; }
.desktop-preferences input { width: 18px; height: 18px; accent-color: var(--accent); flex-shrink: 0; } .desktop-preferences label:has(input:disabled) { opacity: .55; cursor: default; }
.desktop-shortcuts { border-top: 1px solid var(--line); margin-top: 20px; padding-top: 16px; } .desktop-shortcuts summary { cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 8px; min-height: 32px; }
.desktop-shortcuts ul { list-style: none; margin: 10px 0; padding: 0; } .desktop-shortcuts li { display: flex; align-items: center; gap: 12px; padding: 8px 0; font-size: 12px; } .desktop-shortcuts li span { min-width: 110px; } kbd { font-family: inherit; color: var(--text); } .desktop-shortcuts small { margin-left: auto; color: var(--muted); }
.desktop-actions { margin: 20px 0 12px; justify-content: space-between; } .desktop-quit { display: inline-flex; gap: 6px; align-items: center; }
@media (max-width: 1050px) { .desktop-panel { padding: 20px; } .desktop-heading { flex-wrap: wrap; } .desktop-shortcuts li { flex-wrap: wrap; } }
</style>
