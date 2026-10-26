export const themePreferences = ['system', 'light', 'dark'] as const;
export type ThemePreference = typeof themePreferences[number];

export const appearanceChannels = {
  getPreference: 'starsmusic:appearance:get-preference',
  setPreference: 'starsmusic:appearance:set-preference',
} as const;

export interface AppearanceApi {
  getPreference(): Promise<ThemePreference>;
  setPreference(preference: ThemePreference): Promise<ThemePreference>;
}

export function parseThemePreference(value: unknown): ThemePreference {
  if (value !== 'system' && value !== 'light' && value !== 'dark')
    throw new Error('外观选项无效');
  return value;
}

export function parseAppearanceArguments(channel: string, args: readonly unknown[]): ThemePreference | undefined {
  if (channel === appearanceChannels.getPreference && args.length === 0) return undefined;
  if (channel === appearanceChannels.setPreference && args.length === 1) return parseThemePreference(args[0]);
  throw new Error('外观命令参数无效');
}
