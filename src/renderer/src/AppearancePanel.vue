<script setup lang="ts">
import { Monitor, Moon, Sun, Check } from '@lucide/vue';
import { useAppearance } from './useAppearance';
const appearance = useAppearance();
const options = [
  { value: 'system', title: '跟随系统', detail: '随桌面外观自动切换', icon: Monitor },
  { value: 'light', title: '浅色', detail: '云瓷白 · 通透轻盈', icon: Sun },
  { value: 'dark', title: '暗色', detail: '曜石黑 · 柔光沉浸', icon: Moon },
] as const;
</script>
<template>
  <section class="appearance-panel" aria-labelledby="appearance-title">
    <div class="section-heading">
      <div><h2 id="appearance-title">外观与配色</h2><p>为你的音乐空间，选一种光。</p></div>
      <span class="appearance-current">当前{{ appearance.resolvedTheme.value === 'light' ? '浅色' : '暗色' }}</span>
    </div>
    <fieldset class="theme-options" :disabled="appearance.busy.value">
      <legend class="sr-only">配色模式</legend>
      <label v-for="option in options" :key="option.value" class="theme-option" :class="[option.value, { selected: appearance.preference.value === option.value }]">
        <input type="radio" name="appearance" :value="option.value" :aria-label="option.title" :checked="appearance.preference.value === option.value" @change="appearance.setPreference(option.value)" />
        <span class="theme-swatch" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="theme-option-copy"><component :is="option.icon" :size="17" /><strong>{{ option.title }}</strong><Check v-if="appearance.preference.value === option.value" class="theme-check" :size="16" /></span>
        <small>{{ option.detail }}</small>
      </label>
    </fieldset>
    <p v-if="appearance.error.value" class="error-message" role="alert">{{ appearance.error.value }}</p>
  </section>
</template>
