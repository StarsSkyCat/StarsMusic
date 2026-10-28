import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
async function output(command, args) {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve, reject) => execFile(command, args, { cwd: root, encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
}
async function digest(file) { return createHash('sha256').update(await readFile(file)).digest('hex'); }
async function audit(directory) {
  const base = await realpath(directory); let count = 0;
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name); const relative = path.relative(base, full);
      if (/(^|\/)(artifacts|test-results|playwright-report|\.git|\.aws|\.codex|userData|user-data)(\/|$)/.test(relative)
        || /(^|\/)(credentials(?:\.[^.]+)?\.json|cookies?\.(json|txt)|tokens?\.json|login-session\.json|playback-session\.json|\.env(?:\..*)?)$/.test(relative)
        || /\.(?:sqlite3?|db|key|pem|p12|pfx|har|log)(?:-|$)/i.test(entry.name)) throw new Error(`Forbidden package entry: ${relative}`);
      if (entry.isSymbolicLink()) {
        const target = await realpath(full);
        if (!target.startsWith(base + path.sep)) throw new Error(`Non-portable package link: ${relative}`);
      } else if (entry.isDirectory()) await visit(full);
      else count++;
    }
  }
  await visit(base); return count;
}

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This package target requires Linux x86_64');
const osRelease = await readFile('/etc/os-release', 'utf8');
if (!/^ID=(?:"?arch"?)$/m.test(osRelease)) throw new Error('Build this native package on Arch Linux');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const electronPackage = path.dirname(require.resolve('electron/package.json'));
const electronVersion = (await readFile(path.join(electronPackage, 'dist/version'), 'utf8')).trim();
if (electronVersion !== manifest.devDependencies.electron) throw new Error('Electron runtime version does not match the pinned dependency');
const commit = await output('git', ['rev-parse', 'HEAD']);
const short = commit.slice(0, 8); const revision = await output('git', ['rev-list', '--count', 'HEAD']);
const dirty = Boolean(await output('git', ['status', '--porcelain']));
const version = `${manifest.version}.r${revision}.g${short}${dirty ? '.local' : ''}`;
if (!/^[0-9A-Za-z.]+$/.test(version)) throw new Error('Invalid native package version');
const release = path.join(root, 'release'); await mkdir(release, { recursive: true });
const work = await mkdtemp(path.join(tmpdir(), 'starsmusic-arch-'));
const portable = path.join(release, `starsmusic-${version}-linux-x64`);
try {
  await run('pnpm', ['build']);
  const deployed = path.join(work, 'deploy');
  // pnpm performs the production dependency closure; project files use package.json's explicit allowlist.
  await run('pnpm', ['--filter', 'starsmusic', '--prod', 'deploy', '--legacy', '--frozen-lockfile', '--prefer-offline', '--store-dir', path.join(release, '.pnpm-store'), '--ignore-scripts', deployed]);
  const allowed = new Set(['out', 'node_modules', 'package.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs']);
  for (const entry of await readdir(deployed)) if (!allowed.has(entry)) throw new Error(`Unexpected deployed project entry: ${entry}`);
  await writeFile(path.join(deployed, 'package.json'), JSON.stringify({ name: manifest.name, version: manifest.version, private: true, type: 'module', main: manifest.main, description: manifest.description, license: manifest.license, dependencies: manifest.dependencies }, null, 2) + '\n');
  // pnpm's installation metadata contains build-machine paths and is not needed by the runtime.
  for (const name of ['.modules.yaml', '.pnpm-workspace-state-v1.json', '.bin', '.pnpm/lock.yaml']) await rm(path.join(deployed, 'node_modules', name), { recursive: true, force: true });
  await run('rsvg-convert', ['--width', '256', '--height', '256', '--output', path.join(deployed, 'icon.png'), path.join(root, 'packaging/linux/org.starsmusic.StarsMusic.svg')]);
  const runtime = path.join(work, 'starsmusic');
  await cp(path.join(electronPackage, 'dist'), runtime, { recursive: true, verbatimSymlinks: true });
  await rename(path.join(runtime, 'electron'), path.join(runtime, 'starsmusic'));
  await rm(path.join(runtime, 'resources/default_app.asar'), { force: true });
  await cp(deployed, path.join(runtime, 'resources/app'), { recursive: true, verbatimSymlinks: true });
  const files = await audit(runtime);
  await writeFile(path.join(runtime, 'BUILD-METADATA.json'), JSON.stringify({ application: manifest.name, version: manifest.version, packageVersion: version, commit, localChanges: dirty, electron: electronVersion, platform: 'linux', architecture: 'x64', auditedFiles: files }, null, 2) + '\n');
  const payload = 'starsmusic-runtime.tar.zst';
  await run('tar', ['--zstd', '-cf', path.join(work, payload), '-C', work, 'starsmusic'], { env: { ...process.env, ZSTD_CLEVEL: '6', ZSTD_NBTHREADS: '2' } });
  const inputs = [payload, 'starsmusic-launcher', 'org.starsmusic.StarsMusic.desktop', 'org.starsmusic.StarsMusic.svg', 'starsmusic.png', 'THIRD_PARTY_NOTICES.md'];
  for (const [source, target] of [
    ['packaging/linux/starsmusic', inputs[1]], ['packaging/linux/org.starsmusic.StarsMusic.desktop.in', inputs[2]],
    ['packaging/linux/org.starsmusic.StarsMusic.svg', inputs[3]], ['THIRD_PARTY_NOTICES.md', inputs[5]],
  ]) await cp(path.join(root, source), path.join(work, target));
  await cp(path.join(deployed, 'icon.png'), path.join(work, inputs[4]));
  await run('desktop-file-validate', [path.join(work, inputs[2])]);
  const checksums = await Promise.all(inputs.map(name => digest(path.join(work, name))));
  const template = await readFile(path.join(root, 'packaging/linux/PKGBUILD.in'), 'utf8');
  await writeFile(path.join(work, 'PKGBUILD'), template.replace('@PKGVER@', version).replace('@CHECKSUMS@', checksums.map(hash => `'${hash}'`).join(' ')));
  await writeFile(path.join(work, 'makepkg.conf'), "source /etc/makepkg.conf\nCOMPRESSZST=(zstd -c -T2 -6 -)\n");
  await run('makepkg', ['--config', path.join(work, 'makepkg.conf'), '--noconfirm', '--noprogressbar', '--nosign', '--force'], { cwd: work, env: { ...process.env, PKGDEST: release, BUILDDIR: path.join(work, 'build'), PACKAGER: 'StarsMusic local build' } });
  const packageFile = path.join(release, `starsmusic-${version}-1-x86_64.pkg.tar.zst`);
  if (!(await stat(packageFile)).isFile()) throw new Error('Native package was not produced');
  // Keep a standalone copy for pre-install smoke checks, without any dependency on the source checkout.
  await rm(portable, { recursive: true, force: true });
  await cp(runtime, portable, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
  const packageHash = await digest(packageFile);
  await writeFile(packageFile + '.sha256', `${packageHash}  ${path.basename(packageFile)}\n`);
  await writeFile(path.join(release, 'latest-arch.json'), JSON.stringify({ packageFile, portable, version, sha256: packageHash, commit, localChanges: dirty }, null, 2) + '\n');
  console.log(`Arch package ready: ${packageFile}\nAudited runtime files: ${files}\nSHA-256: ${packageHash}`);
} finally { await rm(work, { recursive: true, force: true }); }
