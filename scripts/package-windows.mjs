import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, Platform, Arch } from 'electron-builder';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const output = promisify(execFile);
function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, shell: false, windowsHide: true, stdio: 'inherit', ...options });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Build command exited ${code}`)));
  });
}
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
async function audit(directory) {
  const base = await realpath(directory); let count = 0;
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name); const relative = path.relative(base, full).split(path.sep).join('/');
      if (/(^|\/)(artifacts|test-results|playwright-report|\.git|\.aws|\.codex|\.local|userData|user-data)(\/|$)/i.test(relative)
        || /(^|\/)(credentials(?:\.[^.]+)?\.json|cookies?\.(json|txt)|tokens?\.json|login-session\.json|playback-session\.json|\.env(?:\..*)?)$/i.test(relative)
        || /\.(?:sqlite3?|db|key|pem|p12|pfx|har|log)(?:-|$)/i.test(entry.name)) throw new Error(`Forbidden package entry: ${relative}`);
      if (entry.isSymbolicLink()) {
        const target = await realpath(full); const relativeTarget = path.relative(base, target);
        if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) throw new Error(`Non-portable package link: ${relative}`);
      } else if (entry.isDirectory()) await visit(full);
      else count++;
    }
  }
  await visit(base); return count;
}

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 is required');
if (!process.env.npm_execpath?.endsWith('.cjs')) throw new Error('Run this script with pnpm package:win');
const pnpm = args => run(process.execPath, [process.env.npm_execpath, ...args]);
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const mpv = JSON.parse(await readFile(path.join(root, 'packaging/windows/mpv-runtime.json'), 'utf8'));
const mpvDirectory = path.resolve(process.env.STARSMUSIC_MPV_DIR ?? path.join(root, '.local/mpv'));
for (const [file, expected] of Object.entries(mpv.files)) {
  if (await digest(path.join(mpvDirectory, file)) !== expected) throw new Error(`mpv checksum mismatch: ${file}`);
}
const electronDirectory = path.join(path.dirname(require.resolve('electron/package.json')), 'dist');
if ((await readFile(path.join(electronDirectory, 'version'), 'utf8')).trim() !== manifest.devDependencies.electron) throw new Error('Electron version mismatch');
const commit = (await output('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
const dirty = Boolean((await output('git', ['status', '--porcelain'], { cwd: root })).stdout.trim());
const revision = (await output('git', ['rev-list', '--count', 'HEAD'], { cwd: root })).stdout.trim();
const version = `${manifest.version}-dev.${revision}.${commit.slice(0, 8)}${dirty ? '.local' : ''}`;
const release = path.join(root, 'release', `windows-${version}`); await mkdir(release, { recursive: true });
await mkdir(path.join(root, '.local'), { recursive: true });
const work = await mkdtemp(path.join(root, '.local', 'windows-build-'));
try {
  await pnpm(['build']);
  const deployed = path.join(work, 'app');
  await pnpm(['--filter', 'starsmusic', '--prod', 'deploy', '--legacy', '--frozen-lockfile', '--prefer-offline', '--store-dir', path.join(root, 'release/.pnpm-store'), '--ignore-scripts', deployed]);
  for (const entry of await readdir(deployed)) if (!['out', 'node_modules', 'package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs'].includes(entry)) throw new Error(`Unexpected deployed entry: ${entry}`);
  await writeFile(path.join(deployed, 'package.json'), JSON.stringify({ name: manifest.name, productName: 'StarsMusic', version, private: true, type: 'module', main: manifest.main, description: manifest.description, license: manifest.license, dependencies: manifest.dependencies }, null, 2) + '\n');
  for (const name of ['.modules.yaml', '.pnpm-workspace-state-v1.json', '.bin', '.pnpm/lock.yaml']) {
    const target = path.resolve(deployed, 'node_modules', name);
    if (!target.startsWith(path.resolve(work) + path.sep)) throw new Error('Invalid staging path');
    await rm(target, { recursive: true, force: true });
  }
  await audit(deployed);
  const assets = path.join(work, 'assets'); await mkdir(assets);
  const iconEnv = { ...process.env }; delete iconEnv.ELECTRON_RUN_AS_NODE; delete iconEnv.ELECTRON_RENDERER_URL;
  await run(path.join(electronDirectory, 'electron.exe'), [path.join(root, 'scripts/render-windows-icon.cjs'), path.join(root, 'packaging/linux/org.starsmusic.StarsMusic.svg'), assets], { env: iconEnv });
  const audio = path.join(work, 'mpv'); await mkdir(audio);
  for (const file of Object.keys(mpv.files)) await cp(path.join(mpvDirectory, file), path.join(audio, file));
  await cp(path.join(root, 'packaging/windows/licenses'), path.join(audio, 'licenses'), { recursive: true });
  await cp(path.join(root, 'packaging/windows/mpv-runtime.json'), path.join(audio, 'BUILD-SOURCE.json'));
  await cp(path.join(root, 'packaging/windows/THIRD_PARTY.md'), path.join(audio, 'THIRD_PARTY.md'));
  await cp(path.join(electronDirectory, 'LICENSE'), path.join(work, 'LICENSE.electron.txt'));
  const metadata = { application: 'StarsMusic', version, commit, localChanges: dirty, electron: manifest.devDependencies.electron, mpv: mpv.version, platform: 'win32', architecture: 'x64', signed: false };
  await writeFile(path.join(work, 'BUILD-METADATA.json'), JSON.stringify(metadata, null, 2) + '\n');
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  process.env.ELECTRON_BUILDER_CACHE ??= path.join(root, '.cache/electron-builder');
  const artifacts = await build({ targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), publish: 'never', config: {
    appId: 'org.starsmusic.StarsMusic', productName: 'StarsMusic', executableName: 'StarsMusic',
    directories: { app: deployed, output: release, buildResources: assets }, electronDist: electronDirectory, electronVersion: manifest.devDependencies.electron,
    asar: false, npmRebuild: false, nodeGypRebuild: false, compression: 'normal',
    files: ['out/**/*', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/licenses/**/*'],
    extraResources: [{ from: audio, to: 'mpv' }, { from: path.join(assets, 'starsmusic.png'), to: 'icon.png' }, { from: path.join(work, 'BUILD-METADATA.json'), to: 'BUILD-METADATA.json' }, { from: path.join(work, 'LICENSE.electron.txt'), to: 'LICENSE.electron.txt' }],
    win: { target: 'nsis', icon: path.join(assets, 'starsmusic.ico'), requestedExecutionLevel: 'asInvoker', signAndEditExecutable: true, artifactName: 'StarsMusic-${version}-x64-Setup.${ext}' },
    nsis: { oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true, runAfterFinish: false, deleteAppDataOnUninstall: false,
      createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'StarsMusic', packElevateHelper: false, installerLanguages: ['zh_CN', 'en_US'], displayLanguageSelector: true },
    afterPack: async context => {
      const directory = path.resolve(context.appOutDir);
      if (!directory.startsWith(path.resolve(release) + path.sep)) throw new Error('Invalid runtime output directory');
      await rm(path.join(directory, 'resources/default_app.asar'), { force: true });
      console.log(`Audited Windows runtime files: ${await audit(directory)}`);
    },
  } });
  const installer = artifacts.find(file => file.endsWith('-Setup.exe'));
  if (!installer || !(await stat(installer)).isFile()) throw new Error('EXE installer missing');
  const sha256 = await digest(installer);
  await writeFile(installer + '.sha256', `${sha256}  ${path.basename(installer)}\n`);
  await writeFile(path.join(root, 'release/latest-windows.json'), JSON.stringify({ ...metadata, installer, unpacked: path.join(release, 'win-unpacked'), sha256 }, null, 2) + '\n');
  console.log(`Windows installer ready: ${installer}\nSHA-256: ${sha256}`);
} finally {
  const resolved = path.resolve(work);
  if (!resolved.startsWith(path.resolve(root, '.local') + path.sep)) throw new Error('Invalid temporary directory');
  await rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
