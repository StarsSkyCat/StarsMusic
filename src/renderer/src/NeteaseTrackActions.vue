<script setup lang="ts">
import { nextTick, ref, useId } from 'vue';
import { Heart, ListPlus, MoreHorizontal, Trash2 } from '@lucide/vue';
const props = defineProps<{ id: string; title: string; liked: boolean; likesReady: boolean; removable?: boolean; busy: boolean }>();
const emit = defineEmits<{ like: [id: string, liked: boolean]; add: [id: string]; remove: [id: string] }>();
const menuId = useId(); const trigger = ref<HTMLButtonElement>(); const panel = ref<HTMLElement>(); const open = ref(false);
const position = ref({ left: '0px', top: '0px' });
function close(restore = true): void { panel.value?.hidePopover(); open.value = false; if (restore) trigger.value?.focus(); }
async function show(): Promise<void> {
  if (open.value) { close(); return; }
  const bounds = trigger.value?.getBoundingClientRect(); if (!bounds) return;
  position.value = { left: `${Math.max(10, Math.min(bounds.right - 210, window.innerWidth - 220))}px`, top: `${Math.max(10, Math.min(bounds.bottom + 7, window.innerHeight - (props.removable ? 150 : 106) - 14))}px` };
  panel.value?.showPopover(); open.value = true; await nextTick(); panel.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}
function action(kind: 'like' | 'add' | 'remove'): void { close(); if (kind === 'like') emit('like', props.id, !props.liked); else if (kind === 'add') emit('add', props.id); else emit('remove', props.id); }
function keys(event: KeyboardEvent): void {
  const items = [...panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []];
  if (event.key === 'Escape') { event.preventDefault(); close(); }
  else if (event.key === 'Tab') close(false);
  else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
    event.preventDefault(); const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
}
</script>
<template>
  <span class="netease-track-actions">
    <button ref="trigger" class="icon-button" :disabled="busy" :aria-label="`更多操作 ${title}`" :title="liked ? '已喜欢 · 更多操作' : '喜欢与歌单操作'" aria-haspopup="menu" :aria-expanded="open" :aria-controls="menuId" @click="show" @keydown.down.prevent="show"><Heart v-if="liked" :size="15" fill="currentColor" class="liked-heart" /><MoreHorizontal v-else :size="17" /></button>
    <div :id="menuId" ref="panel" class="ne-action-menu" popover="auto" role="menu" :aria-label="`${title}的操作`" :style="position" @toggle="open = $event.newState === 'open'" @keydown="keys">
      <button role="menuitem" :disabled="busy || !likesReady" @click="action('like')"><Heart :size="16" :fill="liked ? 'currentColor' : 'none'" />{{ liked ? '取消喜欢' : '添加喜欢' }}<small v-if="!likesReady">待同步</small></button>
      <button role="menuitem" :disabled="busy" @click="action('add')"><ListPlus :size="16" />添加到歌单</button>
      <button v-if="removable" role="menuitem" :disabled="busy" @click="action('remove')"><Trash2 :size="16" />从歌单移除</button>
    </div>
  </span>
</template>
<style>
.ne-action-menu { position: fixed; inset: auto; margin: 0; width: 210px; padding: 6px; color: var(--text); background: color-mix(in srgb, var(--floating-glass) 90%, transparent); backdrop-filter: blur(30px) saturate(1.3); border: 1px solid var(--glass-edge); border-radius: 17px; box-shadow: 0 14px 40px #0003, inset 0 1px 0 #ffffff20; }
.ne-action-menu button { display: flex; width: 100%; justify-content: flex-start; gap: 12px; min-height: 44px; padding: 11px 13px; background: transparent; box-shadow: none; border: 0; font-size: 12px; color: var(--text); }
.ne-action-menu button:hover:not(:disabled) { background: var(--hover); }
.ne-action-menu button small { margin-left: auto; font-size: 9px; color: var(--muted); }
.ne-action-menu button:focus-visible { outline-offset: -2px; }
.liked-heart { color: var(--rose); }
.netease-track-actions { display: inline-flex; }
.row-actions:has(.netease-track-actions) { width: 142px; }
</style>
