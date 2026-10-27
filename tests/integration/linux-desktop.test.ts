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
