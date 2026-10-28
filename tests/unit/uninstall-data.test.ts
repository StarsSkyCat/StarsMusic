import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const cleanup = fileURLToPath(new URL('../../packaging/linux/remove-user-data.sh', import.meta.url));
const hook = fileURLToPath(new URL('../../packaging/linux/starsmusic.install', import.meta.url));
const linuxUser = process.platform === 'linux' && process.getuid?.() !== 0;

test('Arch 卸载以用户权限删除配置、密钥、队列和缓存，停止对应运行时并保留其他文件/进程', { skip: !linuxUser }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'starsmusic-uninstall-'));
  const runtime = path.join(home, 'installed', 'starsmusic');
  const sibling = path.join(home, 'other', 'starsmusic');
  await mkdir(path.dirname(runtime)); await mkdir(path.dirname(sibling));
  await copyFile('/bin/sleep', runtime); await chmod(runtime, 0o700);
  await copyFile('/bin/sleep', sibling); await chmod(sibling, 0o700);
  const player = spawn(runtime, ['60']);
  const other = spawn(sibling, ['60']);
  const exited = new Promise<string | null>(resolve => player.once('exit', (_code, signal) => resolve(signal)));
  try {
    for (const file of ['.config/StarsMusic/keys/login.key', '.config/StarsMusic/credentials.sqlite', '.config/StarsMusic/playback.sqlite', '.config/StarsMusic/desktop.json', '.cache/StarsMusic/cache', '.config/OtherApp/keep', 'Music/song.wav']) {
      await mkdir(path.dirname(path.join(home, file)), { recursive: true });
      await writeFile(path.join(home, file), 'synthetic uninstall fixture');
    }
    await execute('/bin/sh', [cleanup, runtime], { env: { ...process.env, HOME: home } });
    assert.equal(await exited, 'SIGTERM');
    assert.equal(other.exitCode, null); assert.equal(other.signalCode, null);
    await assert.rejects(lstat(path.join(home, '.config/StarsMusic')), { code: 'ENOENT' });
    await assert.rejects(lstat(path.join(home, '.cache/StarsMusic')), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(home, 'Music/song.wav'), 'utf8'), 'synthetic uninstall fixture');
    assert.equal(await readFile(path.join(home, '.config/OtherApp/keep'), 'utf8'), 'synthetic uninstall fixture');
    // Repeated cleanup succeeds without recreating app data.
    await execute('/bin/sh', [cleanup, runtime], { env: { ...process.env, HOME: home } });
  } finally {
    player.kill(); other.kill(); await rm(home, { recursive: true, force: true });
  }
});

test('Arch 卸载不跟随配置根目录或应用目录符号链接，不删除用户音乐', { skip: !linuxUser }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'starsmusic-uninstall-links-'));
  try {
    const external = path.join(home, 'Music'); await mkdir(external);
    await writeFile(path.join(external, 'keep'), 'synthetic music');
    await mkdir(path.join(home, '.config'));
    await symlink(external, path.join(home, '.config/StarsMusic'));
    await symlink(external, path.join(home, '.cache'));
    const { stderr } = await execute('/bin/sh', [cleanup], { env: { ...process.env, HOME: home } });
    assert.match(stderr, /redirected/);
    assert.equal(await readFile(path.join(external, 'keep'), 'utf8'), 'synthetic music');
    await assert.rejects(lstat(path.join(home, '.config/StarsMusic')), { code: 'ENOENT' });
    assert.equal((await lstat(path.join(home, '.cache'))).isSymbolicLink(), true);
    await assert.rejects(execute('/bin/sh', [cleanup], { env: { ...process.env, HOME: '/' } }));
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('Arch 删除钩子筛选普通账号并经 runuser 降权，单个账号失败后继续其他账号', { skip: process.platform !== 'linux' }, async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'starsmusic-uninstall-hook-'));
  try {
    const passwd = path.join(work, 'synthetic-passwd');
    const trace = path.join(work, 'calls');
    await writeFile(passwd, [`root:x:0:0::${work}:/bin/sh`, `service:x:99:99::${work}:/bin/sh`, `first:x:1000:1000::${work}:/bin/sh`, `second:x:1001:1001::${work}:/bin/sh`, `nobody:x:65534:65534::${work}:/bin/sh`].join('\n') + '\n');
    const { stderr } = await execute('bash', ['-c', `
      source "$1"
      getent() { cat "$SYNTHETIC_PASSWD"; }
      runuser() { printf '%s\\n' "$*" >> "$SYNTHETIC_TRACE"; [ "$2" != first ]; }
      pre_remove
    `, 'synthetic-uninstall-test', hook], { env: { ...process.env, SYNTHETIC_PASSWD: passwd, SYNTHETIC_TRACE: trace } });
    const calls = (await readFile(trace, 'utf8')).trim().split('\n');
    assert.equal(calls.length, 2);
    assert.match(calls[0]!, /^-u first -- env -u XDG_CONFIG_HOME -u XDG_CACHE_HOME HOME=/);
    assert.match(calls[1]!, /^-u second -- env .*\/bin\/sh \/usr\/lib\/starsmusic\/remove-user-data.sh$/);
    assert.match(stderr, /uid 1000/);
  } finally { await rm(work, { recursive: true, force: true }); }
});
