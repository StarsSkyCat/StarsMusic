import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MusicPlayer } from '../../packages/playback/src/player.ts';
import { MpvClient } from '../../packages/playback/src/mpv-client.ts';
import { writeSilentWav } from '../helpers/audio.ts';
import { mpvProcesses } from '../helpers/mpv-processes.ts';
import { MediaGateway, type FetchMedia } from '../../packages/playback/src/media-gateway.ts';
import { parseKugouStream, parseKugouResourceIdentity } from '../../packages/providers/src/kugou/service.ts';
import type { StreamResolution } from '../../packages/contracts/src/music.ts';
import { DomainError } from '../../packages/contracts/src/errors.ts';

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 6000;
  while (!(await check())) {
    if (Date.now() > deadline) assert.fail('等待实际 mpv 状态超时');
    await delay(20);
  }
}
async function children(): Promise<number[]> {
  return (await mpvProcesses()).map(item => item.pid);
}

test('损坏文件失败后等待 2.5 秒绕过单曲循环，下一首实际解码且只保留一个 mpv', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-skip-broken-'));
  const player = new MusicPlayer({ audioOutput: 'null' });
  const broken = path.join(directory, 'broken.wav'); const good = path.join(directory, 'good.wav');
  let failedAt = 0;
  const unsubscribe = player.subscribe(state => { if (!failedAt && state.status === 'error') failedAt = Date.now(); });
  try {
    await writeFile(broken, 'synthetic damaged audio'); await writeSilentWav(good, 10);
    player.setMode('track'); await player.openFiles([broken, good]);
    await until(() => player.snapshot().status === 'error');
    assert.equal(player.snapshot().error?.code, 'playback-failed');
    await until(() => player.snapshot().status === 'playing' && player.snapshot().currentIndex === 1);
    assert.ok(Date.now() - failedAt >= 2400);
    await until(() => player.snapshot().positionSeconds > 0);
    assert.equal(player.snapshot().error, undefined);
    assert.equal((await children()).length, 1);
  } finally { unsubscribe(); await player.dispose(); await rm(directory, { recursive: true, force: true }); }
  assert.deepEqual(await children(), []);
});

test('双平台取链失败后继续下一首，经真实网关与 mpv 播放合成音频', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-skip-online-'));
  const file = path.join(directory, 'synthetic.wav'); await writeSilentWav(file, 10);
  const audio = await readFile(file);
  const fetch: FetchMedia = async () => ({ status: 200, headers: { 'content-type': 'audio/wav', 'content-length': String(audio.length) }, stream: Readable.from([audio]) });
  const player = new MusicPlayer({ audioOutput: 'null', openGateway: (url, signal, provider) => MediaGateway.open(url, signal, fetch, provider) });
  try {
    for (const provider of ['netease', 'kugou'] as const) {
      const stream: StreamResolution = { track: { provider, id: 'synthetic' },
        source: { kind: 'remote', url: provider === 'netease' ? 'https://m1.music.126.net/synthetic' : 'https://fsandroid.kugou.com/synthetic', headers: {} },
        access: { kind: 'full' }, quality: { level: 'standard' } };
      await player.openRemoteList(provider, [
        { title: '合成不可用资源', sourceId: 'unavailable', resolve: async () => { throw new DomainError('unavailable'); } },
        { title: '合成可播放资源', sourceId: 'synthetic', resolve: async () => stream },
      ]);
      assert.equal(player.snapshot().status, 'error');
      await until(() => player.snapshot().status === 'playing' && player.snapshot().currentIndex === 1 && player.snapshot().positionSeconds > 0);
      assert.equal((await children()).length, 1);
      await player.stop(); assert.deepEqual(await children(), []);
    }
  } finally { await player.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('真实 mpv EOF 驱动随机结束、列表回绕、单曲重播和随机一轮不重复，停止不自动重播', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-mode-mpv-'));
  const player = new MusicPlayer({ audioOutput: 'null' });
  const files = ['a.wav', 'b.wav', 'c.wav'].map(file => path.join(directory, file));
  try {
    await Promise.all(files.map(file => writeSilentWav(file, .4)));
    for (const mode of ['none', 'playlist', 'track'] as const) {
      player.setLoopMode(mode);
      const played: string[] = []; let generation = -1;
      const unsubscribe = player.subscribe(state => {
        if (state.status === 'playing' && state.generation !== generation) {
          generation = state.generation; played.push(state.queue[state.currentIndex!]!.title);
        }
      });
      await player.openFiles(files.slice(0, 2));
      const order = player.snapshot().queue.map(track => track.title);
      if (mode === 'none') { await until(() => player.snapshot().status === 'ended'); assert.deepEqual(played, order); }
      else {
        await until(() => played.length >= 3);
        assert.deepEqual(played.slice(0, 3), mode === 'track' ? ['a.wav', 'a.wav', 'a.wav'] : ['a.wav', 'b.wav', 'a.wav']);
      }
      unsubscribe(); await player.stop(); const stopped = player.snapshot().generation;
      await delay(100); assert.equal(player.snapshot().status, 'idle'); assert.equal(player.snapshot().generation, stopped);
    }
    player.setLoopMode('none'); player.setShuffle(true);
    const played: string[] = []; let generation = -1;
    const unsubscribe = player.subscribe(state => {
      if (state.status === 'playing' && state.generation !== generation) { generation = state.generation; played.push(state.queue[state.currentIndex!]!.id); }
    });
    await player.openFiles(files); const order = player.snapshot().queue.map(track => track.id);
    await until(() => player.snapshot().status === 'ended'); unsubscribe();
    assert.deepEqual(played, order); assert.equal(new Set(played).size, 3);
    assert.ok((await children()).length <= 1);
  } finally { await player.dispose(); await rm(directory, { recursive: true, force: true }); }
  assert.deepEqual(await children(), []);
});

test('实际 mpv 平台 IPC 握手、请求关联、头重置与退出清理', async () => {
  const client = new MpvClient({ audioOutput: 'null', onEvent: () => undefined, onFailure: () => undefined });
  try {
    assert.match(await client.start(), /mpv/);
    await assert.rejects(client.start());
    assert.equal((await children()).length, 1);
    const [volume, pause] = await Promise.all([client.command(['get_property', 'volume']), client.command(['get_property', 'pause'])]);
    assert.equal(typeof volume, 'number'); assert.equal(typeof pause, 'boolean');
    await client.command(['set_property', 'http-header-fields', ['X-Test: synthetic']]);
    await client.command(['set_property', 'http-header-fields', []]);
    assert.deepEqual(await client.command(['get_property', 'http-header-fields']), []);
    await assert.rejects(client.command(['get_property', 'nonexistent-test-property']));
    assert.equal(await client.command(['get_property', 'pause']), false);
    const commandLine = (await mpvProcesses()).find(item => item.pid === client.pid)!.commandLine;
    if (process.platform === 'win32') {
      assert.match(commandLine, /--input-ipc-server=\\\\\.\\pipe\\starsmusic-[0-9a-f-]{36}/);
      assert.ok(!commandLine.includes('--input-ipc-client'));
    } else {
      assert.ok(commandLine.includes('--input-ipc-client=fd://3'));
      assert.ok(!commandLine.includes('--input-ipc-server'));
    }
    assert.ok(!commandLine.includes('synthetic'));
  } finally { await client.close(); }
  assert.deepEqual(await children(), []);
});

test('真实解码、暂停、定位、音量、快速切歌、停止与崩溃后显式恢复', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-mpv-'));
  const first = path.join(directory, '音频 with spaces.wav');
  const second = path.join(directory, 'second.wav');
  const player = new MusicPlayer({ audioOutput: 'null' });
  try {
    await Promise.all([writeSilentWav(first), writeSilentWav(second)]);
    await player.openFiles([first, second]);
    await until(() => player.snapshot().status === 'playing' && player.snapshot().durationSeconds > 0);
    assert.ok(!JSON.stringify(player.snapshot()).includes(directory));
    await player.pause(); await until(() => player.snapshot().status === 'paused');
    await player.seek(5); await until(() => Math.abs(player.snapshot().positionSeconds - 5) < .3);
    await Promise.all([player.setVolume(10),player.setVolume(90),player.setVolume(47)]);
    assert.equal(player.snapshot().volume,47);
    await player.setMuted(true); assert.equal(player.snapshot().muted,true); assert.equal(player.snapshot().volume,47);
    await player.setMuted(false); assert.equal(player.snapshot().muted,false);
    await player.setVolume(35); await until(() => player.snapshot().volume === 35);
    await player.resume(); await until(() => player.snapshot().status === 'playing');
    const oldPid = (await children())[0]!;
    const queue = player.snapshot().queue;
    await Promise.all([player.playTrack(queue[1]!.id), player.playTrack(queue[0]!.id), player.playTrack(queue[1]!.id)]);
    await until(() => player.snapshot().status === 'playing' && player.snapshot().currentIndex === 1);
    assert.throws(() => process.kill(oldPid, 0));
    assert.equal((await children()).length, 1);
    assert.equal(player.snapshot().volume, 35);
    const crashedPid = (await children())[0]!;
    process.kill(crashedPid, 'SIGKILL');
    await until(() => player.snapshot().status === 'error');
    await player.playTrack(queue[0]!.id);
    await until(() => player.snapshot().status === 'playing');
    assert.equal((await children()).length, 1);
    await player.stop();
    assert.equal(player.snapshot().status, 'idle');
    assert.deepEqual(await children(), []);
    await player.resume();
    await until(() => player.snapshot().status === 'playing');
  } finally {
    await player.dispose();
    await rm(directory, { recursive: true, force: true });
  }
  assert.deepEqual(await children(), []);
});

test('EOF、损坏/缺失文件、快速停止和缺失 mpv 不冒充播放成功', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-mpv-errors-'));
  const short = path.join(directory, 'short.wav');
  const broken = path.join(directory, 'broken.wav');
  const player = new MusicPlayer({ audioOutput: 'null' });
  const missingEngine = new MusicPlayer({ executable: path.join(directory, 'missing-mpv') });
  try {
    await writeSilentWav(short, 0.3); await writeFile(broken, 'not an audio file');
    player.setMode('shuffle'); await player.openFiles([short]); await until(() => player.snapshot().status === 'ended');
    await player.openFiles([broken]); await until(() => player.snapshot().status === 'error');
    assert.equal(player.snapshot().error?.code, 'playback-failed');
    // 伪装成音频的播放列表不能间接打开其他文件。
    await writeFile(broken, `#EXTM3U\n${short}\n`);
    await player.openFiles([broken]); await until(() => player.snapshot().status === 'error');
    await player.openFiles([path.join(directory, 'missing.wav')]);
    assert.equal(player.snapshot().error?.code, 'file-unavailable');
    await Promise.all([player.openFiles([short]), player.stop()]);
    assert.equal(player.snapshot().status, 'idle');
    assert.deepEqual(await children(), []);
    await missingEngine.openFiles([short]);
    assert.equal(missingEngine.snapshot().status, 'error');
    assert.equal(missingEngine.snapshot().error?.code, 'engine-unavailable');
  } finally {
    await Promise.all([player.dispose(), missingEngine.dispose()]);
    await rm(directory, { recursive: true, force: true });
  }
  assert.deepEqual(await children(), []);
});

test('实际 mpv 通过 loopback 网关解码合成在线资源，限制试听并清理旧解析/网关', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-remote-mpv-'));
  const file = path.join(directory, 'synthetic.wav');
  await writeSilentWav(file, 10);
  const audio = await readFile(file);
  const fetcher: FetchMedia = async (_url, headers) => {
    const start = Number(/^bytes=(\d+)-/.exec(headers.Range ?? '')?.[1] ?? 0);
    const body = audio.subarray(start);
    return { status: start > 0 ? 206 : 200, headers: {
      'content-type': 'audio/wav', 'content-length': String(body.length), 'accept-ranges': 'bytes',
      ...(start > 0 ? { 'content-range': `bytes ${start}-${audio.length - 1}/${audio.length}` } : {}),
    }, stream: Readable.from([body]) };
  };
  const player = new MusicPlayer({ audioOutput: 'null', openGateway: (url, signal, provider) => MediaGateway.open(url, signal, fetcher, provider) });
  const resource: StreamResolution = {
    track: { provider: 'netease', id: '7' }, source: { kind: 'remote', url: 'https://m1.music.126.net/synthetic', headers: {} },
    access: { kind: 'preview', startMs: 0, durationMs: 1000 }, quality: { level: 'unknown' },
  };
  try {
    await player.openRemote('netease', '合成在线曲目', async () => resource);
    await until(() => player.snapshot().status === 'playing');
    assert.ok(player.snapshot().queue[0]?.detail?.includes('试听'));
    assert.ok(!JSON.stringify(player.snapshot()).includes('music.126.net'));
    await until(() => player.snapshot().durationSeconds > 0);
    assert.ok(player.snapshot().durationSeconds <= 1);
    const generation = player.snapshot().generation;
    await player.clearRemote('kugou'); assert.equal(player.snapshot().generation, generation);
    await player.clearRemote('netease'); assert.deepEqual(player.snapshot().queue, []);
    const kugou = parseKugouStream({ status: 1, hash: 'a'.repeat(32), url: ['https://fsandroid.kugou.com/synthetic'],
      priv_status: 1, is_full_audio: 0, fileName: `${'a'.repeat(32)} - 123456789.mp`, timeLength: 10, free_part_start: 9000, free_part_end: 10000,
    }, 'b'.repeat(32), { name: '合成酷狗曲目', durationMs: 10000 }, 'full',
      parseKugouResourceIdentity({ status: 1, data: [{ hash: 'b'.repeat(32), name: '合成酷狗曲目', relate_goods: [{ hash: 'a'.repeat(32) }] }] }, 'b'.repeat(32)));
    player.setMode('shuffle'); await player.openRemote('kugou', '合成酷狗曲目', async () => kugou);
    await until(() => player.snapshot().status === 'playing');
    assert.ok(player.snapshot().queue[0]?.provider === 'kugou');
    await until(() => player.snapshot().status === 'ended');
    assert.ok(player.snapshot().durationSeconds <= 1);
    assert.ok(player.snapshot().positionSeconds <= 1);
    const kugouGeneration = player.snapshot().generation;
    await player.clearRemote('netease'); assert.equal(player.snapshot().generation, kugouGeneration);
    await player.clearRemote('kugou');

    assert.deepEqual(await children(), []);
    let resolve!: (value: StreamResolution) => void;
    const delayed = new Promise<StreamResolution>((done) => { resolve = done; });
    const old = player.openRemote('netease', '旧解析', async () => delayed);
    const current = player.openFiles([file]); resolve(resource);
    await Promise.all([old, current]); await until(() => player.snapshot().status === 'playing');
    assert.equal(player.snapshot().queue[0]?.title, 'synthetic.wav');
    assert.equal((await children()).length, 1);
  } finally { await player.dispose(); await rm(directory, { recursive: true, force: true }); }
  assert.deepEqual(await children(), []);
});

test('插队不打断实际音频，EOF 自动播放下一首并保留唯一 mpv 进程', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-next-mpv-'));
  const first = path.join(directory, 'first.wav');
  const second = path.join(directory, 'second.wav');
  const third = path.join(directory, 'third.wav');
  const player = new MusicPlayer({ audioOutput: 'null' });
  try {
    await Promise.all([writeSilentWav(first, 1), writeSilentWav(second, 10), writeSilentWav(third, 10)]);
    await player.openFiles([first, second, third]);
    await until(() => player.snapshot().status === 'playing');
    const generation = player.snapshot().generation;
    const pid = (await children())[0];
    const thirdId = player.snapshot().queue[2]!.id;
    player.moveNext(thirdId);
    assert.equal(player.snapshot().generation, generation);
    assert.equal((await children())[0], pid);
    await until(() => player.snapshot().status === 'playing' && player.snapshot().queue[player.snapshot().currentIndex!]?.id === thirdId);
    assert.equal(player.snapshot().currentIndex, 1);
    assert.equal((await children()).length, 1);
    assert.throws(() => process.kill(pid!, 0));
  } finally { await player.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('真实解码重启恢复：启动暂停且不创建 mpv，用户继续后从书签定位并保留静音', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-resume-mpv-')); const file = path.join(directory, 'resume.wav');
  const first = new MusicPlayer({ audioOutput: 'null' }); const second = new MusicPlayer({ audioOutput: 'null' });
  try {
    await writeSilentWav(file); await first.openFiles([file]);
    await until(() => first.snapshot().status === 'playing' && first.snapshot().durationSeconds > 0);
    await first.pause(); await until(() => first.snapshot().status === 'paused');
    await first.seek(8); await until(() => Math.abs(first.snapshot().positionSeconds - 8) < .3);
    await first.setVolume(41); await first.setMuted(true);
    const saved = first.exportSession(); await first.dispose();
    second.restoreSession(saved, async () => { throw new Error('unexpected online resolve'); });
    assert.equal(second.snapshot().status, 'paused'); assert.deepEqual(await children(), []);
    assert.equal(second.snapshot().positionSeconds, saved.positionSeconds); assert.equal(second.snapshot().volume, 41); assert.equal(second.snapshot().muted, true);
    await second.seek(11); await second.resume();
    await until(() => second.snapshot().status === 'playing' && second.snapshot().positionSeconds >= 10.9);
    assert.equal((await children()).length, 1);
    assert.match((await mpvProcesses())[0]!.commandLine, /--start=11/);
    await second.setMuted(false); assert.equal(second.snapshot().volume, 41);
  } finally { await first.dispose(); await second.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('在线恢复重新获取实际权限，旧完整播放书签超出试听范围时限制到本次试听', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starsmusic-resume-preview-')); const file = path.join(directory, 'synthetic.wav');
  await writeSilentWav(file, 5); const audio = await readFile(file);
  const fetch: FetchMedia = async (_url, headers) => {
    const start = Number(/^bytes=(\d+)-/.exec(headers.Range ?? '')?.[1] ?? 0); const body = audio.subarray(start);
    return { status: start > 0 ? 206 : 200, headers: { 'content-type': 'audio/wav', 'content-length': String(body.length), 'accept-ranges': 'bytes',
      ...(start > 0 ? { 'content-range': `bytes ${start}-${audio.length - 1}/${audio.length}` } : {}) }, stream: Readable.from([body]) };
  };
  const player = new MusicPlayer({ audioOutput: 'null', openGateway: (url, signal, provider) => MediaGateway.open(url, signal, fetch, provider) });
  try {
    player.restoreSession({ version: 1, queue: [{ id: 'saved-online', kind: 'netease', sourceId: '7', accountId: '42', title: '合成试听' }],
      currentId: 'saved-online', positionSeconds: 100, durationSeconds: 200, volume: 30, muted: false, lastAudibleVolume: 30 },
    async () => ({ track: { provider: 'netease', id: '7' }, source: { kind: 'remote', url: 'https://m10.music.126.net/synthetic', headers: {} },
      quality: { level: 'standard' }, access: { kind: 'preview', startMs: 0, durationMs: 2000 } }));
    player.setMode('shuffle'); await player.resume(); await until(() => player.snapshot().status === 'ended');
    assert.ok(player.snapshot().durationSeconds <= 2); assert.ok(player.snapshot().positionSeconds <= 2);
    await player.stop(); assert.deepEqual(await children(), []);
  } finally { await player.dispose(); await rm(directory, { recursive: true, force: true }); }
});
