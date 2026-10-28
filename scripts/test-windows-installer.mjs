import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('Windows is required');
const root = fileURLToPath(new URL('../', import.meta.url));
const latest = JSON.parse(await readFile(path.join(root, 'release/latest-windows.json'), 'utf8'));
const hash = createHash('sha256').update(await readFile(latest.installer)).digest('hex');
if (hash !== latest.sha256) throw new Error('Installer checksum mismatch');
const execute = promisify(execFile);
async function registrations() {
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'StarsMusic*' }).Count"], { windowsHide: true });
  return Number(stdout.trim());
}
function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, shell: false, windowsHide: true, stdio: 'inherit', ...options });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Installer test command timed out')); }, 120000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Installer command exited ${code}`)); });
  });
}
async function exists(file) { try { await access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function until(check) {
  const deadline = Date.now() + 30000;
  while (!await check()) { if (Date.now() > deadline) throw new Error('Installer state did not settle'); await delay(200); }
}
if (await registrations()) throw new Error('An existing StarsMusic installation was found; refusing to replace it during testing');
const work = await mkdtemp(path.join(root, '.local', 'windows-installer-test-'));
const installed = path.join(work, 'StarsMusic 测试安装');
const uninstall = path.join(installed, 'Uninstall StarsMusic.exe');
let clean = false;
try {
  // NSIS /D 必须是最后的、未加引号的参数；使用参数数组直启进程，无 shell。
  await run(latest.installer, ['/S', `/D=${installed}`], { windowsVerbatimArguments: true });
  await until(() => exists(path.join(installed, 'StarsMusic.exe')));
  if (!(await stat(uninstall)).isFile()) throw new Error('Uninstaller was not installed');
  if (await registrations() !== 1) throw new Error('Windows uninstall registration missing');
  await run(process.execPath, [path.join(root, 'scripts/smoke-windows.mjs'), path.join(installed, 'StarsMusic.exe')]);
  await run(uninstall, ['/S']);
  await until(async () => !await exists(path.join(installed, 'StarsMusic.exe')) && await registrations() === 0);
  clean = true;
  console.log('Windows EXE install/uninstall passed: per-user silent installation into a Chinese/spaced path, installed-runtime smoke and uninstall registry cleanup.');
} finally {
  if (!clean && await exists(uninstall)) {
    await run(uninstall, ['/S']); await until(async () => await registrations() === 0);
  }
  const resolved = path.resolve(work);
  if (!resolved.startsWith(path.resolve(root, '.local') + path.sep)) throw new Error('Invalid installer test directory');
  await rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
