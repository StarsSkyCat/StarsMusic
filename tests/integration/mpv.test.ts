import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MusicPlayer } from '../../packages/playback/src/player.ts';
import { MpvClient } from '../../packages/playback/src/mpv-client.ts';
import { writeSilentWav } from '../helpers/audio.ts';
import { MediaGateway, type FetchMedia } from '../../packages/playback/src/media-gateway.ts';
import { parseKugouStream, parseKugouResourceIdentity } from '../../packages/providers/src/kugou/service.ts';
import type { StreamResolution } from '../../packages/contracts/src/music.ts';

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 6000;
  while (!(await check())) {
    if (Date.now() > deadline) assert.fail('等待实际 mpv 状态超时');
    await delay(20);
  }
}
async function children(): Promise<number[]> {
  const pids = (await readFile(`/proc/self/task/${process.pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean);
  const result: number[] = [];
  for (const pid of pids) {
    try { if ((await readlink(`/proc/${pid}/exe`)).endsWith('/mpv')) result.push(Number(pid)); } catch { /* 已退出 */ }
  }
  return result;
}

test('实际 mpv 私有 FD 握手、请求关联、头重置与退出清理', async () => {
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
    const commandLine = await readFile(`/proc/${client.pid}/cmdline`, 'utf8');
    assert.ok(commandLine.includes('--input-ipc-client=fd://3'));
    assert.ok(!commandLine.includes('--input-ipc-server'));
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
    await player.seek(5); await until(() => player.snapshot().positionSeconds >= 4.9);
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
    await player.openFiles([short]); await until(() => player.snapshot().status === 'ended');
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
      priv_status: 1, is_full_audio: 0, fileName: '合成酷狗曲目', timeLength: 10, free_part_start: 9000, free_part_end: 10000,
    }, 'b'.repeat(32), { name: '合成酷狗曲目', durationMs: 10000 }, 'full',
      parseKugouResourceIdentity({ status: 1, data: [{ hash: 'b'.repeat(32), name: '合成酷狗曲目', relate_goods: [{ hash: 'a'.repeat(32) }] }] }, 'b'.repeat(32)));
    await player.openRemote('kugou', '合成酷狗曲目', async () => kugou);
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
