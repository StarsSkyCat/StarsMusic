import { _electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeSilentWav } from '../tests/helpers/audio.ts';
import { mpvProcesses } from '../tests/helpers/mpv-processes.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'win32') throw new Error('Windows is required');
const latest = JSON.parse(await readFile(path.join(root, 'release/latest-windows.json'), 'utf8'));
const executable = path.resolve(process.argv[2] ?? path.join(latest.unpacked, 'StarsMusic.exe'));
const profile = await mkdtemp(path.join(root, '.local', 'windows-smoke-'));
const audio = path.join(profile, '合成安装包音频.wav'); await writeSilentWav(audio);
const env = { ...process.env, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` };
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
await mkdir(path.join(root, 'artifacts'), { recursive: true });
const launch = () => _electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], env, chromiumSandbox: true, timeout: 15000 });
let desktop; let mpvPid;
try {
  desktop = await launch(); let page = await desktop.firstWindow(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
  const identity = await desktop.evaluate(({ app, BrowserWindow }) => ({ packaged: app.isPackaged, name: app.getName(), resources: process.resourcesPath,
    sandbox: app.getAppMetrics().find(metric => metric.pid === BrowserWindow.getAllWindows()[0].webContents.getOSProcessId())?.sandboxed }));
  if (!identity.packaged || identity.name !== 'StarsMusic' || identity.sandbox !== true) throw new Error('Packaged identity or sandbox failed');
  const initial = await page.evaluate(async () => ({ netease: (await window.starsMusic.netease.getState()).status, kugou: (await window.starsMusic.kugou.getState()).status,
    credentials: await window.starsMusic.credentials.getStatus(), queue: (await window.starsMusic.playback.getState()).queue.length }));
  if (initial.netease !== 'signed-out' || initial.kugou !== 'signed-out' || initial.queue !== 0 || !initial.credentials.available) throw new Error('Isolated workers or SQLite unavailable');
  await page.evaluate(async () => { await window.starsMusic.credentials.setRemember('kugou', true); await window.starsMusic.credentials.clear(); });
  await desktop.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, audio);
  await page.getByRole('button', { name: '选择本地音频', exact: true }).click();
  const state = () => page.evaluate(() => window.starsMusic.playback.getState());
  await expect.poll(async () => (await state()).status).toBe('playing');
  await expect.poll(async () => (await state()).audioOutput).toBe('wasapi');
  const pids = await mpvProcesses(await desktop.evaluate(() => process.pid));
  if (pids.length !== 1 || !pids[0].commandLine.toLowerCase().includes(path.join(identity.resources, 'mpv', 'mpv.exe').toLowerCase())) throw new Error('Bundled mpv ownership failed');
  mpvPid = pids[0].pid;
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(async () => (await state()).status).toBe('paused');
  await page.evaluate(async () => { await window.starsMusic.playback.seek(8); await window.starsMusic.playback.setVolume(37); });
  await expect.poll(async () => (await state()).positionSeconds).toBeGreaterThan(7.7);
  await new Promise((resolve, reject) => {
    const second = spawn(executable, [`--user-data-dir=${profile}`], { env, windowsHide: true, shell: false, stdio: 'ignore' });
    const timer = setTimeout(() => { second.kill(); reject(new Error('Second instance did not exit')); }, 10000);
    second.once('error', error => { clearTimeout(timer); reject(error); });
    second.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Second instance failed')); });
  });
  if ((await state()).queue.length !== 1) throw new Error('Second instance changed queue');
  await page.screenshot({ path: path.join(root, 'artifacts/windows-packaged.png'), animations: 'disabled' });
  const closed = desktop.waitForEvent('close'); await page.getByRole('button', { name: '关闭窗口', exact: true }).click(); await closed; await desktop.close(); desktop = undefined;
  let running = true; try { process.kill(mpvPid, 0); } catch { running = false; }
  if (running) throw new Error('mpv survived packaged application exit');
  desktop = await launch(); page = await desktop.firstWindow();
  await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
  await expect.poll(async () => (await state()).status).toBe('paused');
  const restored = await state();
  if (restored.queue.length !== 1 || restored.volume !== 37 || restored.positionSeconds < 7.7) throw new Error('Packaged SQLite restore failed');
  if ((await mpvProcesses(await desktop.evaluate(() => process.pid))).length) throw new Error('Restored application played automatically');
  await page.evaluate(() => window.starsMusic.playback.resume()); await expect.poll(async () => (await state()).status).toBe('playing');
  if (errors.length) throw new Error('Packaged renderer error');
  console.log(`Windows packaged smoke passed: sandbox, anonymous workers, SQLite, bundled mpv without PATH, WASAPI, seek, single instance, restart restore and exit cleanup. Executable: ${executable}`);
} finally {
  await desktop?.close();
  const resolved = path.resolve(profile);
  if (!resolved.startsWith(path.resolve(root, '.local') + path.sep)) throw new Error('Invalid smoke profile path');
  await rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
