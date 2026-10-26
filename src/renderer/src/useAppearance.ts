import { computed, nextTick, readonly, ref, watch } from 'vue';
import { parseThemePreference, type ThemePreference } from '../../../packages/contracts/src/appearance';

const preference = ref<ThemePreference>('system');
const systemDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches);
const resolvedTheme = computed(() => preference.value === 'system' ? (systemDark.value ? 'dark' : 'light') : preference.value);
const busy = ref(false);
const error = ref('');

watch([preference, systemDark], () => {
  document.documentElement.dataset.theme = resolvedTheme.value;
  document.documentElement.dataset.themePreference = preference.value;
}, { immediate: true });

export async function initializeAppearance(): Promise<void> {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
    systemDark.value = event.matches;
  });
  try {
    if (window.starsMusic) preference.value = parseThemePreference(await window.starsMusic.appearance.getPreference());
  } catch { error.value = '外观偏好读取失败，已跟随系统。'; }
}

async function setPreference(value: ThemePreference): Promise<void> {
  if (busy.value) return;
  const previous = preference.value;
  busy.value = true;
  error.value = '';
  preference.value = value;
  await nextTick();
  try {
    if (!window.starsMusic) throw new Error('bridge unavailable');
    preference.value = parseThemePreference(await window.starsMusic.appearance.setPreference(value));
  } catch {
    preference.value = previous;
    error.value = '外观偏好未能保存，请重试。';
  }
  finally { busy.value = false; }
}

export function useAppearance() {
  return { preference: readonly(preference), resolvedTheme, busy: readonly(busy), error: readonly(error), setPreference };
}
