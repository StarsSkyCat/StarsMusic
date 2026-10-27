import type { ShortcutId } from '../../contracts/src/system.ts';
export const shortcuts = [
  { id: 'toggle', label: '播放 / 暂停', accelerator: 'Control+Alt+Space', trigger: 'CTRL+ALT+space', key: ' ' },
  { id: 'previous', label: '上一首', accelerator: 'Control+Alt+Left', trigger: 'CTRL+ALT+Left', key: 'ArrowLeft' },
  { id: 'next', label: '下一首', accelerator: 'Control+Alt+Right', trigger: 'CTRL+ALT+Right', key: 'ArrowRight' },
  { id: 'mute', label: '静音 / 取消静音', accelerator: 'Control+Alt+M', trigger: 'CTRL+ALT+m', key: 'm' },
  { id: 'show', label: '显示主窗口', accelerator: 'Control+Alt+O', trigger: 'CTRL+ALT+o', key: 'o' },
] as const satisfies readonly { id: ShortcutId; label: string; accelerator: string; trigger: string; key: string }[];
export interface ShortcutInput { type: string; key: string; control: boolean; alt: boolean; meta: boolean; shift: boolean; isAutoRepeat: boolean }
export function windowShortcut(input: ShortcutInput): ShortcutId | undefined {
  if (input.type !== 'keyDown' || input.isAutoRepeat || !input.control || !input.alt || input.meta || input.shift) return undefined;
  return shortcuts.find(shortcut => shortcut.key.toLowerCase() === input.key.toLowerCase())?.id;
}
