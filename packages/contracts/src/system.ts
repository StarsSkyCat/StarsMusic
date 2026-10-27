import { parseAppError, type AppError } from './errors.ts';
import { choice, ContractValidationError, nonNegativeInteger, record, text } from './validation.ts';
export const capabilityStates = ['available', 'unavailable', 'unknown', 'pending', 'disabled'] as const;
export type CapabilityState = typeof capabilityStates[number];
export interface Capability { state: CapabilityState; detail: string }
export const systemPreferenceKeys = ['notifications', 'tray', 'closeToTray', 'globalShortcuts'] as const;
export type SystemPreferenceKey = typeof systemPreferenceKeys[number];
export type SystemPreferences = Record<SystemPreferenceKey, boolean>;
export const shortcutIds = ['toggle', 'previous', 'next', 'mute', 'show'] as const;
export type ShortcutId = typeof shortcutIds[number];
export interface ShortcutBinding { id: ShortcutId; label: string; accelerator: string; state: CapabilityState; trigger?: string }
export interface SystemSnapshot {
  revision: number; platform: string; session: 'wayland' | 'x11' | 'unknown'; desktop: string;
  bus: Capability; mpris: Capability; notifications: Capability; tray: Capability; portal: Capability; shortcuts: Capability;
  preferences: SystemPreferences; bindings: ShortcutBinding[]; mprisName?: string; portalVersion?: number; error?: AppError;
}
export const systemChannels = { getState: 'starsmusic:system:get-state', changed: 'starsmusic:system:changed', refresh: 'starsmusic:system:refresh',
  quit: 'starsmusic:system:quit',
  setPreference: 'starsmusic:system:set-preference', testNotification: 'starsmusic:system:test-notification' } as const;
export interface SystemApi {
  getState(): Promise<SystemSnapshot>; refresh(): Promise<SystemSnapshot>;
  setPreference(key: SystemPreferenceKey, enabled: boolean): Promise<SystemSnapshot>;
  testNotification(): Promise<SystemSnapshot>; quit(): Promise<void>;
  onChanged(listener: (state: SystemSnapshot) => void): () => void;
}
export function defaultSystemPreferences(): SystemPreferences { return { notifications: false, tray: true, closeToTray: false, globalShortcuts: false }; }
export function parseSystemPreferences(value: unknown): SystemPreferences {
  const raw = record(value, 'system.preferences');
  if (Object.keys(raw).length !== systemPreferenceKeys.length || Object.keys(raw).some(key => !(systemPreferenceKeys as readonly string[]).includes(key))
    || systemPreferenceKeys.some(key => typeof raw[key] !== 'boolean')) throw new ContractValidationError('system.preferences');
  return { notifications: raw.notifications as boolean, tray: raw.tray as boolean, closeToTray: raw.closeToTray as boolean, globalShortcuts: raw.globalShortcuts as boolean };
}
export function parseSystemSnapshot(value: unknown): SystemSnapshot {
  const raw = record(value, 'system');
  const capability = (value: unknown): Capability => { const cap = record(value, 'system.capability'); return { state: choice(cap.state, capabilityStates, 'system.capability.state'), detail: text(cap.detail, 'system.capability.detail') }; };
  if (!Array.isArray(raw.bindings) || raw.bindings.length > shortcutIds.length) throw new ContractValidationError('system.bindings');
  const bindings = raw.bindings.map(value => { const item = record(value, 'system.binding'); return { id: choice(item.id, shortcutIds, 'system.binding.id'), label: text(item.label, 'system.binding.label'),
    accelerator: text(item.accelerator, 'system.binding.accelerator'), state: choice(item.state, capabilityStates, 'system.binding.state'), ...(item.trigger === undefined ? {} : { trigger: text(item.trigger, 'system.binding.trigger') }) }; });
  if (new Set(bindings.map(binding => binding.id)).size !== bindings.length) throw new ContractValidationError('system.bindings');
  return { revision: nonNegativeInteger(raw.revision, 'system.revision'), platform: text(raw.platform, 'system.platform'), session: choice(raw.session, ['wayland', 'x11', 'unknown'], 'system.session'), desktop: text(raw.desktop, 'system.desktop'),
    bus: capability(raw.bus), mpris: capability(raw.mpris), notifications: capability(raw.notifications), tray: capability(raw.tray), portal: capability(raw.portal), shortcuts: capability(raw.shortcuts),
    preferences: parseSystemPreferences(raw.preferences), bindings, ...(raw.mprisName === undefined ? {} : { mprisName: text(raw.mprisName, 'system.mprisName') }),
    ...(raw.portalVersion === undefined ? {} : { portalVersion: nonNegativeInteger(raw.portalVersion, 'system.portalVersion') }), ...(raw.error === undefined ? {} : { error: parseAppError(raw.error) }) };
}
export function parseSystemArguments(channel: string, args: readonly unknown[]): { key: SystemPreferenceKey; enabled: boolean } | undefined {
  if (channel === systemChannels.setPreference && args.length === 2 && typeof args[1] === 'boolean') return { key: choice(args[0], systemPreferenceKeys, 'system.preference'), enabled: args[1] };
  const noArguments: readonly string[] = [systemChannels.getState, systemChannels.refresh, systemChannels.testNotification, systemChannels.quit];
  if (noArguments.includes(channel) && args.length === 0) return undefined;
  throw new ContractValidationError('system.arguments');
}
