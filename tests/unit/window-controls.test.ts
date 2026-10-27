import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWindowCommand, parseWindowSnapshot, windowChannels } from '../../packages/contracts/src/window.ts';
import { controlWindow, windowChrome, windowSnapshot, type WindowPort } from '../../packages/desktop/src/window-controls.ts';

test('窗口 IPC 仅允许无参白名单操作，状态不投影额外字段', () => {
  assert.equal(parseWindowCommand(windowChannels.close, []), 'close');
  for (const [channel, args] of [[windowChannels.minimize, ['other-window']], [windowChannels.changed, []], ['arbitrary', []]] as const) assert.throws(() => parseWindowCommand(channel, args));
  const state = { platform: 'linux', maximized: false, fullscreen: false, focused: true };
  assert.deepEqual(parseWindowSnapshot({ ...state, private: 'synthetic' }), state);
  for (const value of [{ ...state, maximized: 1 }, { ...state, platform: 'arbitrary' }, null]) assert.throws(() => parseWindowSnapshot(value));
});

test('最大化可还原、全屏先退出，关闭遵循原生 close 生命周期；macOS 保留原生按钮', () => {
  let maximized = false; let fullscreen = false; let closed = false; let minimized = false;
  const window: WindowPort = { isMaximized: () => maximized, isFullScreen: () => fullscreen, isFocused: () => true,
    minimize: () => { minimized = true; }, maximize: () => { maximized = true; }, unmaximize: () => { maximized = false; },
    setFullScreen: enabled => { fullscreen = enabled; }, close: () => { closed = true; } };
  controlWindow(window, 'toggleMaximize'); assert.equal(windowSnapshot(window, 'linux').maximized, true);
  controlWindow(window, 'toggleMaximize'); assert.equal(maximized, false);
  fullscreen = true; controlWindow(window, 'toggleMaximize'); assert.equal(fullscreen, false); assert.equal(maximized, false);
  controlWindow(window, 'minimize'); assert.equal(minimized, true);
  controlWindow(window, 'close'); assert.equal(closed, true);
  assert.deepEqual(windowChrome('linux'), { frame: false }); assert.deepEqual(windowChrome('win32'), { frame: false });
  assert.equal(windowChrome('darwin').titleBarStyle, 'hiddenInset'); assert.equal(windowSnapshot(window, 'freebsd').platform, 'other');
});
