import { _electron, expect } from '@playwright/test';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dbus from 'dbus-next';
import { writeSilentWav } from '../tests/helpers/audio.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const latest = JSON.parse(await readFile(path.join(root, 'release/latest-arch.json'), 'utf8'));
const executable = process.argv[2] ?? path.join(latest.portable, 'starsmusic');
const backends = [...(process.env.WAYLAND_DISPLAY ? ['wayland'] : []), ...(process.env.DISPLAY ? ['x11'] : [])];
if (!backends.length) throw new Error('A graphical desktop session is required');
await mkdir(path.join(root, 'artifacts'), { recursive: true });
for (const backend of backends) {
  const profile = await mkdtemp(path.join(tmpdir(), 'starsmusic-package-smoke-'));
  const audio = path.join(profile, 'synthetic-packaged-audio.wav'); await writeSilentWav(audio, 30);
  const env = { ...process.env, GSETTINGS_BACKEND: 'memory' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.STARSMUSIC_DEBUG;
  let desktop; let bus;
  try {
    desktop = await _electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`, `--ozone-platform=${backend}`], env, chromiumSandbox: true, timeout: 15000 });
    const page = await desktop.firstWindow(); page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
    const packaged = await desktop.evaluate(({ app, BrowserWindow }) => ({ packaged: app.isPackaged, name: app.getName(), sandbox: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox }));
    if (!packaged.packaged || !packaged.sandbox || packaged.name !== 'StarsMusic') throw new Error('Packaged identity or sandbox check failed');
    const state = () => page.evaluate(() => window.starsMusic.playback.getState());
    const accounts = await page.evaluate(async () => ({ netease: (await window.starsMusic.netease.getState()).status, kugou: (await window.starsMusic.kugou.getState()).status, queue: (await window.starsMusic.playback.getState()).queue.length }));
    if (accounts.netease !== 'signed-out' || accounts.kugou !== 'signed-out' || accounts.queue !== 0) throw new Error('Isolated package must start without account or queue data');
    await desktop.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, audio);
    await page.getByRole('button', { name: '选择本地音频', exact: true }).click();
    await expect.poll(async () => (await state()).status).toBe('playing');
    const output = (await state()).audioOutput;
    if (!output || output === 'null') throw new Error('Packaged test did not use system audio output');
    await expect.poll(async () => (await page.evaluate(() => window.starsMusic.system.getState())).mpris.state).toBe('available');
    const system = await page.evaluate(() => window.starsMusic.system.getState());
    bus = dbus.sessionBus(); bus.on('error', () => {});
    const proxy = await bus.getProxyObject(system.mprisName, '/org/mpris/MediaPlayer2');
    const player = proxy.getInterface('org.mpris.MediaPlayer2.Player');
    await player.Pause(); await expect.poll(async () => (await state()).status).toBe('paused');
    await player.Play(); await expect.poll(async () => (await state()).status).toBe('playing');
    await player.Pause();
    await new Promise((resolve, reject) => {
      const child = spawn(executable, [`--user-data-dir=${profile}`, `--ozone-platform=${backend}`], { env, stdio: 'ignore' });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Second packaged instance did not exit')); }, 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Second instance failed')); });
    });
    if ((await state()).queue.length !== 1) throw new Error('Second instance changed the queue');
    await page.screenshot({ path: path.join(root, `artifacts/packaged-${backend}.png`), animations: 'disabled' });
    if (errors.length) throw new Error('Packaged renderer reported an error');
    console.log(`Packaged ${backend}: identity/sandbox, anonymous workers, system audio=${output}, MPRIS Pause/Play, single instance passed; tray=${system.tray.state}.`);
  } finally {
    bus?.disconnect(); await desktop?.close(); await rm(profile, { recursive: true, force: true });
  }
}
