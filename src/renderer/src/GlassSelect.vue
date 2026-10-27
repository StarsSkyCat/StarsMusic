<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useId } from 'vue';
import { Check, ChevronDown } from '@lucide/vue';
const props = defineProps<{ label: string; options: readonly { value: string; label: string }[] }>();
const value = defineModel<string>({ required: true });
const emit = defineEmits<{ change: [] }>();
const id = useId();
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const open = ref(false);
const position = ref({ left: '0px', top: '0px' });
function close(restore = false): void { panel.value?.hidePopover(); open.value = false; if (restore) trigger.value?.focus(); }
async function show(): Promise<void> {
  if (open.value) { close(); return; }
  const bounds = trigger.value?.getBoundingClientRect();
  if (!bounds) return;
  position.value = { left: `${Math.max(12, Math.min(bounds.right - 156, window.innerWidth - 168))}px`, top: `${Math.max(12, Math.min(bounds.bottom + 8, window.innerHeight - props.options.length * 44 - 28))}px` };
  panel.value?.showPopover(); open.value = true;
  await nextTick();
  panel.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[Math.max(0, props.options.findIndex(item => item.value === value.value))]?.focus();
}
function choose(next: string): void { const changed = value.value !== next; value.value = next; close(true); if (changed) emit('change'); }
function keydown(event: KeyboardEvent): void {
  const buttons = [...panel.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  } else if (event.key === 'Escape') { event.preventDefault(); close(true); }
  else if (event.key === 'Tab') close();
}
function dismiss(): void { close(); }
onMounted(() => { window.addEventListener('resize', dismiss); document.addEventListener('scroll', dismiss, true); });
onUnmounted(() => { window.removeEventListener('resize', dismiss); document.removeEventListener('scroll', dismiss, true); });
</script>
<template>
  <span class="glass-select">
    <button ref="trigger" class="glass-select-trigger" :aria-label="label" :aria-describedby="`${id}-value`" aria-haspopup="menu" :aria-expanded="open" :aria-controls="id" @click="show" @keydown.down.prevent="show" @keydown.up.prevent="show"><span :id="`${id}-value`">{{ options.find(item => item.value === value)?.label }}</span><ChevronDown :size="14" :class="{ rotated: open }" /></button>
    <div :id="id" ref="panel" popover="auto" class="glass-select-menu" role="menu" :aria-label="label" :style="position" @toggle="open = $event.newState === 'open'" @keydown="keydown">
      <button v-for="item in options" :key="item.value" role="menuitemradio" :aria-checked="value === item.value" @click="choose(item.value)">{{ item.label }}<Check v-if="value === item.value" :size="15" /></button>
    </div>
  </span>
</template>
<style>
.glass-select { display: inline-flex; }
.glass-select .glass-select-trigger { min-height: 44px; gap: 8px; padding: 10px 8px; border: 0; border-radius: 10px; box-shadow: none; background: transparent; color: var(--muted); font-size: 11px; }
.glass-select .glass-select-trigger:hover:not(:disabled) { color: var(--text); background: var(--hover); }
.glass-select-trigger svg { transition: transform .18s; }
.glass-select-trigger svg.rotated { transform: rotate(180deg); }
.glass-select-menu { position: fixed; inset: auto; margin: 0; width: 156px; padding: 6px; border: 1px solid var(--glass-edge); border-radius: 17px; color: var(--text); background: color-mix(in srgb, var(--floating-glass) 85%, transparent); backdrop-filter: blur(30px) saturate(1.3); box-shadow: 0 14px 40px #0003, inset 0 1px 0 #ffffff20; }
.glass-select-menu::backdrop { background: transparent; }
.glass-select-menu button { display: flex; width: 100%; justify-content: space-between; min-height: 44px; padding: 11px 13px; border: 0; border-radius: 11px; box-shadow: none; background: transparent; font-size: 12px; color: var(--muted); }
.glass-select-menu button[aria-checked='true'] { color: var(--accent); background: var(--active); }
.glass-select-menu button:hover:not(:disabled) { color: var(--text); background: var(--hover); }
.glass-select-menu button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
@media (prefers-reduced-motion: reduce) { .glass-select-trigger svg { transition: none; } }
</style>
