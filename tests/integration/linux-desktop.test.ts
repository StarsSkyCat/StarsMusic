import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import dbus from 'dbus-next';
import { MusicPlayer } from '../../packages/playback/src/player.ts';
import { LinuxServices } from '../../packages/desktop/src/linux/services.ts';
import { call, createBus, owner, sessionAddress, isSignal } from '../../packages/desktop/src/linux/bus.ts';
import { mprisPath, mprisPlayer, trackPath } from '../../packages/desktop/src/linux/mpris.ts';
import { writeSilentWav } from '../helpers/audio.ts';

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  const end = Date.now() + 6000;
  while (!await check()) { if (Date.now() > end) assert.fail('等待桌面集成状态超时'); await delay(20); }
}

test('独立真实 session D-Bus / mpv：MPRIS 发现、状态、微秒、音量、Seeked、暂停切歌和退出清理', async () => {
  assert.equal(process.env.STARSMUSIC_TEST_BUS, 'isolated', '必须通过 test:desktop 在隔离的 D-Bus 中运行');
  const directory = await mkdtemp('/tmp/starsmusic-mpris-'); const player = new MusicPlayer({ audioOutput: 'null' });
  let raised = 0; let quit = 0; const services = new LinuxServices(player, { show: () => { raised++; }, quit: () => { quit++; } }, { ...process.env, XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'synthetic-missing-backend' });
  const client = createBus(sessionAddress(process.env, process.getuid?.())); client.on('error', () => undefined);
  const seeked: bigint[] = []; let name = '';
  try {
    await services.initialize(); const state = services.snapshot();
    assert.equal(state.mpris.state, 'available'); assert.equal(state.notifications.state, 'unavailable'); assert.equal(state.trayHost.state, 'unavailable');
    assert.equal(state.portal.state, 'unavailable'); assert.equal(state.globalShortcuts.state, 'unavailable'); name = state.mprisName!;
    assert.ok(await owner(client, name));
    const request = (member: string, signature = '', body: unknown[] = []) => call(client, name, mprisPath, mprisPlayer, member, signature, body);
    const get = async (key: string) => (await call(client, name, mprisPath, 'org.freedesktop.DBus.Properties', 'Get', 'ss', [mprisPlayer, key]))[0] as dbus.Variant<unknown>;
    const set = (key: string, value: dbus.Variant) => call(client, name, mprisPath, 'org.freedesktop.DBus.Properties', 'Set', 'ssv', [mprisPlayer, key, value]);
    const changed: Record<string, dbus.Variant>[] = [];
    await call(client, 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'AddMatch', 's', ["type='signal',interface='org.freedesktop.DBus.Properties',member='PropertiesChanged'"]);
    client.on('message', message => {
      if (isSignal(message, 'org.freedesktop.DBus.Properties', 'PropertiesChanged') && message.body[0] === mprisPlayer) changed.push(message.body[1] as Record<string, dbus.Variant>);
    });
    const introspection = await call(client, name, mprisPath, 'org.freedesktop.DBus.Introspectable', 'Introspect');
    assert.ok(String(introspection[0]).includes('org.mpris.MediaPlayer2.Player'));
    await call(client, 'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'AddMatch', 's', [`type='signal',interface='${mprisPlayer}',member='Seeked'`]);
    client.on('message', message => { if (isSignal(message, mprisPlayer, 'Seeked')) seeked.push(message.body[0] as bigint); });
    const files = ['a.wav', 'b.wav', 'c.wav'].map(file => path.join(directory, file)); await Promise.all(files.map(file => writeSilentWav(file)));
    await player.openFiles(files); await until(() => player.snapshot().status === 'playing' && player.snapshot().durationSeconds > 0);
    assert.equal((await get('PlaybackStatus')).value, 'Playing');
    const metadata = (await get('Metadata')).value as Record<string, dbus.Variant>;
    assert.equal(metadata['mpris:trackid']?.signature, 'o'); assert.equal(metadata['mpris:length']?.signature, 'x');
    assert.equal(metadata['mpris:length']?.value, 30000000n); assert.equal(JSON.stringify(metadata, (_, value: unknown) => typeof value === 'bigint' ? value.toString() : value).includes(directory), false);
    await request('Pause'); await until(() => player.snapshot().status === 'paused');
    await call(client, name, mprisPath, 'org.freedesktop.DBus.Properties', 'Set', 'ssv', [mprisPlayer, 'Volume', new dbus.Variant('d', .36)]);
    await until(() => player.snapshot().volume === 36); assert.equal((await get('Volume')).value, .36);
    await request('SetPosition', 'ox', [trackPath(player.snapshot()), 6000000n]); await until(() => seeked.length > 0);
    assert.ok(player.snapshot().positionSeconds > 5.5); assert.equal((await get('Position')).signature, 'x');
    const before = player.snapshot().positionSeconds;
    await request('SetPosition', 'ox', ['/org/starsmusic/track/stale', 0n]); assert.equal(player.snapshot().positionSeconds, before);
    await request('SetPosition', 'ox', [trackPath(player.snapshot()), 99000000n]); assert.equal(player.snapshot().positionSeconds, before);
    await request('Seek', 'x', [-2000000n]); await until(() => player.snapshot().positionSeconds < 5);
    const transitions: string[] = []; const unsubscribe = player.subscribe(state => { transitions.push(state.status); });
    await request('Next'); await until(() => player.snapshot().currentIndex === 1 && player.snapshot().status === 'paused');
    assert.equal(transitions.includes('playing'), false); unsubscribe();
    await request('Stop'); assert.equal((await get('PlaybackStatus')).value, 'Stopped');
    await request('Next'); assert.equal(player.snapshot().currentIndex, 2); assert.equal(player.snapshot().status, 'idle');
    assert.equal((await get('LoopStatus')).value, 'Playlist'); assert.equal((await get('Shuffle')).value, false);
    assert.equal((await get('CanGoNext')).value, true);
    await set('LoopStatus', new dbus.Variant('s', 'Playlist'));
    assert.equal(player.snapshot().loopMode, 'playlist'); assert.equal((await get('CanGoNext')).value, true);
    await request('Next'); assert.equal(player.snapshot().currentIndex, 0); assert.equal(player.snapshot().status, 'idle');
    await request('Previous'); assert.equal(player.snapshot().currentIndex, 2);
    const track = trackPath(player.snapshot()); const generation = player.snapshot().generation;
    await set('Shuffle', new dbus.Variant('b', true));
    assert.equal(player.snapshot().shuffle, true); assert.equal(trackPath(player.snapshot()), track); assert.equal(player.snapshot().generation, generation);
    await set('LoopStatus', new dbus.Variant('s', 'Track')); assert.equal(player.snapshot().loopMode, 'track'); assert.equal(player.snapshot().shuffle, false);
    await assert.rejects(set('LoopStatus', new dbus.Variant('s', 'invalid'))); assert.equal(player.snapshot().loopMode, 'track');
    await assert.rejects(set('Shuffle', new dbus.Variant('s', 'true'))); assert.equal(player.snapshot().shuffle, false);
    await until(() => changed.some(value => value.LoopStatus?.value === 'Playlist') && changed.some(value => value.Shuffle?.value === true));
    player.setLoopMode('none'); player.setShuffle(false);
    assert.equal((await get('LoopStatus')).value, 'Playlist'); assert.equal((await get('Shuffle')).value, false);
    await assert.rejects(request('OpenUri', 's', ['https://example.invalid/arbitrary']));
    await call(client, name, mprisPath, 'org.mpris.MediaPlayer2', 'Raise'); await call(client, name, mprisPath, 'org.mpris.MediaPlayer2', 'Quit');
    assert.equal(raised, 1); assert.equal(quit, 1);
    await services.dispose(); await until(async () => !await owner(client, name));
  } finally { await services.dispose(); await player.dispose(); client.disconnect(); await rm(directory, { recursive: true, force: true }); }
});

test('会话总线不存在时真实连接失败安全降级，应用播放器仍可使用', async () => {
  const player = new MusicPlayer(); const services = new LinuxServices(player, { show() {}, quit() {} }, { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/starsmusic-nonexistent-bus' });
  try { await services.initialize(); assert.equal(services.snapshot().bus.state, 'unavailable'); await player.setVolume(43); assert.equal(player.snapshot().volume, 43); }
  finally { await services.dispose(); await player.dispose(); }
});

// 以下合成服务只存在于本测试的独立总线；协议调用、订阅和播放器均为实际实现。
import { SyntheticDesktopServices } from '../helpers/desktop-services.ts';
import { DesktopController } from '../../packages/desktop/src/controller.ts';
import { DesktopSettings } from '../../packages/desktop/src/settings.ts';
import { LinuxNotifications } from '../../packages/desktop/src/linux/notifications.ts';
import type { PresentationPort } from '../../packages/desktop/src/platform.ts';
import type { DesktopRuntime } from '../../packages/desktop/src/runtime.ts';
import type { PresentationSnapshot } from '../../packages/contracts/src/presentation.ts';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';

test('隔离合成 portal：确认后才标记绑定、早到 Response、授权取消、旧会话/未知动作及迟到结果丢弃', async () => {
  const server = new SyntheticDesktopServices(createBus(sessionAddress(process.env, process.getuid?.()))); await server.initialize();
  const directory = await mkdtemp('/tmp/starsmusic-portal-'); const player = new MusicPlayer(); let show = 0; let visible = false; let destroyed = 0; let native = 0;
  let trayAction: Parameters<DesktopRuntime['createTray']>[0] | undefined;
  const runtime: DesktopRuntime = { show() { show++; visible = true; }, hide() { visible = false; }, quit() {}, isVisible: () => visible,
    registerShortcut() { native++; return false; }, unregisterShortcut() {}, createTray(action) { trayAction = action; server.watcher.RegisterStatusNotifierItem(Reflect.get(server.bus, 'name') as string); return { update() {}, destroy() { destroyed++; } }; } };
  const presentation: PresentationPort = { snapshot: () => ({ revision: 0, generation: 0, status: 'idle', trackId: null }), subscribe: () => () => undefined };
  const controller = new DesktopController(player, presentation, runtime, new DesktopSettings(path.join(directory, 'desktop.json')));
  try {
    await controller.initialize(); assert.equal(controller.snapshot().shortcuts.state, 'disabled'); assert.equal(server.requests, 0);
    await until(() => controller.snapshot().tray.state === 'available');
    await controller.setPreference('closeToTray', true); assert.equal(controller.shouldHideOnClose(), true);
    await controller.setPreference('globalShortcuts', true); assert.equal(controller.snapshot().shortcuts.state, 'pending');
    await until(() => controller.snapshot().shortcuts.state === 'available'); assert.equal(native, 0);
    server.activate('mute'); await until(() => player.snapshot().muted);
    server.activate('invalid'); server.activate('mute', '/org/freedesktop/portal/desktop/session/stale/id'); await delay(30); assert.equal(player.snapshot().muted, true);
    controller.handleInput({ type: 'keyDown', key: 'm', control: true, alt: true, shift: false, meta: false, isAutoRepeat: false });
    assert.equal(player.snapshot().muted, true); // 全局和窗口同一次按键只执行一次。
    await delay(260); controller.handleInput({ type: 'keyDown', key: 'm', control: true, alt: true, shift: false, meta: false, isAutoRepeat: false });
    await until(() => !player.snapshot().muted);
    trayAction!('mute'); await until(() => player.snapshot().muted); // 托盘点击是独立动作，不能误去重。
    server.closeSession(); await until(() => controller.snapshot().shortcuts.state === 'unavailable');
    server.mode = 'denied'; await controller.refresh(); await until(() => controller.snapshot().shortcuts.state === 'unavailable');
    assert.ok(controller.snapshot().bindings.every(binding => binding.state === 'unavailable'));
    server.mode = 'success'; server.closeAfterBind = true; await controller.refresh();
    await until(() => controller.snapshot().shortcuts.state === 'unavailable');
    assert.ok(controller.snapshot().bindings.every(binding => binding.state !== 'available'));
    server.closeAfterBind = false; server.allowed = ['mute', 'show']; await controller.refresh();
    await until(() => controller.snapshot().shortcuts.state === 'unknown');
    assert.equal(controller.snapshot().bindings.filter(binding => binding.state === 'available').length, 2);
    server.mode = 'pending'; await controller.refresh(); await until(() => server.pendingResponses.length > 0);
    assert.equal(controller.snapshot().shortcuts.state, 'pending'); await controller.setPreference('globalShortcuts', false);
    for (const respond of server.pendingResponses) respond(); await delay(40);
    assert.equal(controller.snapshot().shortcuts.state, 'disabled'); assert.ok(server.closedRequests > 0);
    await controller.testNotification(); assert.equal(server.notifications.received.length, 1); assert.equal(controller.snapshot().notifications.state, 'available');
    const notification = server.notifications.received[0]!; server.notifications.ActionInvoked(notification.id, 'default'); await until(() => show > 0);
    visible = false; const before = show; server.watcher.setHost(false);
    await until(() => controller.snapshot().tray.state === 'unavailable'); assert.ok(destroyed > 0); assert.equal(controller.shouldHideOnClose(), false); assert.ok(show > before);
    const raw = JSON.stringify(controller.snapshot()); assert.equal(raw.includes('DBUS_SESSION_BUS_ADDRESS'), false); assert.equal(raw.includes('portalOwner'), false);
  } finally { await controller.dispose(); await player.dispose(); await server.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('隔离合成通知：转义正文、复用通知、点击来源校验及禁用后的关闭', async () => {
  const server = new SyntheticDesktopServices(createBus(sessionAddress(process.env, process.getuid?.()))); await server.initialize();
  const client = createBus(sessionAddress(process.env, process.getuid?.())); client.on('error', () => undefined); let opened = 0;
  const notifications = new LinuxNotifications(client, () => { opened++; });
  try {
    assert.equal(await notifications.send('合成标题', '<b>合成 & 内容</b>'), true);
    assert.equal(server.notifications.received[0]?.body, '&lt;b&gt;合成 &amp; 内容&lt;/b&gt;');
    const id = server.notifications.received[0]!.id; await notifications.send('下一首', '合成歌手'); assert.equal(server.notifications.received[1]?.id, id);
    server.notifications.ActionInvoked(id + 1, 'default'); await delay(20); assert.equal(opened, 0);
    server.notifications.ActionInvoked(id, 'default'); await until(() => opened === 1);
    await notifications.dispose(); assert.ok(server.notifications.closed.includes(id));
    assert.equal(await notifications.send('不再显示', '已关闭'), false);
  } finally { await notifications.dispose(); client.disconnect(); await server.dispose(); }
});

test('MPRIS 封面只用当前代次已校验图片的临时文件，退出删除，无音频路径/远端地址', async () => {
  const directory = await mkdtemp('/tmp/starsmusic-desktop-cover-'); const player = new MusicPlayer({ audioOutput: 'null' });
  let snapshot: PresentationSnapshot = { revision: 0, generation: 0, status: 'idle', trackId: null };
  const listeners = new Set<(snapshot: PresentationSnapshot) => void>();
  const presentation: PresentationPort = { snapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const runtime: DesktopRuntime = { show() {}, hide() {}, quit() {}, isVisible: () => true, registerShortcut: () => false, unregisterShortcut() {}, createTray: () => ({ update() {}, destroy() {} }) };
  const controller = new DesktopController(player, presentation, runtime, new DesktopSettings(path.join(directory, 'desktop.json')));
  const client = createBus(sessionAddress(process.env, process.getuid?.())); client.on('error', () => undefined); let artFile = '';
  try {
    await controller.initialize(); const file = path.join(directory, 'synthetic.wav'); await writeSilentWav(file); await player.openFiles([file]);
    await until(() => player.snapshot().status === 'playing');
    snapshot = { revision: 1, generation: player.snapshot().generation, trackId: player.snapshot().queue[0]!.id, status: 'ready', content: { lyrics: [], artwork: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' } };
    for (const listener of listeners) listener(snapshot);
    await until(async () => {
      const result = await call(client, controller.snapshot().mprisName!, mprisPath, 'org.freedesktop.DBus.Properties', 'Get', 'ss', [mprisPlayer, 'Metadata']);
      const metadata = (result[0] as dbus.Variant<Record<string, dbus.Variant>>).value;
      const url = metadata['mpris:artUrl']?.value as unknown; if (typeof url !== 'string') return false;
      artFile = fileURLToPath(url); assert.notEqual(artFile, file); assert.equal(url.includes('music.126.net'), false); return true;
    });
    assert.equal((await readFile(artFile)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.equal((await stat(artFile)).mode & 0o777, 0o600);
    await controller.dispose(); await assert.rejects(stat(artFile));
  } finally { await controller.dispose(); await player.dispose(); client.disconnect(); await rm(directory, { recursive: true, force: true }); }
});

test('隔离合成通知 / 真实 mpv：只在后台新曲目播放时通知，状态刷新不重复，关闭选项立即撤回', async () => {
  const server = new SyntheticDesktopServices(createBus(sessionAddress(process.env, process.getuid?.()))); await server.initialize();
  const directory = await mkdtemp('/tmp/starsmusic-track-notification-'); const player = new MusicPlayer({ audioOutput: 'null' }); let visible = true;
  const runtime: DesktopRuntime = { show() { visible = true; }, hide() { visible = false; }, quit() {}, isVisible: () => visible,
    registerShortcut: () => false, unregisterShortcut() {}, createTray: () => ({ update() {}, destroy() {} }) };
  const presentation: PresentationPort = { snapshot: () => ({ revision: 0, generation: 0, status: 'idle', trackId: null }), subscribe: () => () => undefined };
  const controller = new DesktopController(player, presentation, runtime, new DesktopSettings(path.join(directory, 'desktop.json')));
  try {
    await controller.initialize(); await controller.setPreference('notifications', true);
    const files = ['synthetic-a.wav', 'synthetic-b.wav'].map(file => path.join(directory, file)); await Promise.all(files.map(file => writeSilentWav(file)));
    await player.openFiles(files); await until(() => player.snapshot().status === 'playing'); assert.equal(server.notifications.received.length, 0);
    visible = false; await player.playTrack(player.snapshot().queue[1]!.id); await until(() => server.notifications.received.length === 1);
    assert.equal(server.notifications.received[0]?.title, 'synthetic-b.wav');
    await player.setVolume(23); await player.pause(); await until(() => player.snapshot().status === 'paused'); await player.resume();
    await until(() => player.snapshot().status === 'playing'); assert.equal(server.notifications.received.length, 1);
    await controller.setPreference('notifications', false); assert.ok(server.notifications.closed.length > 0);
    await player.playTrack(player.snapshot().queue[0]!.id); await until(() => player.snapshot().status === 'playing'); assert.equal(server.notifications.received.length, 1);
  } finally { await controller.dispose(); await player.dispose(); await server.dispose(); await rm(directory, { recursive: true, force: true }); }
});
