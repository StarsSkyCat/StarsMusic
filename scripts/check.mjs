import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set([
  '.git', '.agents', '.aws', '.codex', '.local', '.cache', '.pnpm-store',
  'node_modules', 'dist', 'out', 'release', 'artifacts', 'coverage',
  'test-results', 'playwright-report', '.idea', '.vscode',
]);
const failures = [];
let markdownCount = 0;

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(location));
    else if (entry.isFile()) result.push(location);
  }
  return result;
}

function fail(file, message) {
  failures.push(`${path.relative(root, file)}: ${message}`);
}

async function checkMarkdown(file, content) {
  markdownCount += 1;
  const visible = [];
  let fence;
  for (const [index, line] of content.split('\n').entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = { char: marker[1][0], size: marker[1].length };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.size
        && marker[2].trim() === '') fence = undefined;
      continue;
    }
    if (!fence) visible.push({ line, number: index + 1 });
  }
  if (fence) fail(file, '存在未关闭的 Markdown 代码围栏');

  // Check inline local links; external URLs and anchors are intentionally offline.
  for (const { line, number } of visible) {
    for (const match of line.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
      const target = match[1] ?? match[2];
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(target)) continue;
      let decoded;
      try {
        decoded = decodeURIComponent(target.split(/[?#]/, 1)[0]);
      } catch {
        fail(file, `第 ${number} 行链接编码无效`);
        continue;
      }
      if (!decoded) continue;
      const destination = path.resolve(path.dirname(file), decoded);
      const relative = path.relative(root, destination);
      if (relative === '..' || relative.startsWith(`..${path.sep}`)) {
        fail(file, `第 ${number} 行链接指向仓库外部：${target}`);
        continue;
      }
      try {
        const info = await stat(destination);
        if (!info.isFile() && !info.isDirectory()) throw new Error('invalid target');
      } catch {
        fail(file, `第 ${number} 行链接目标不存在：${target}`);
      }
    }
  }
}

const required = [
  'README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'package.json',
  'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.gitignore', '.editorconfig',
  'docs/README.md', 'docs/development.md', 'docs/testing.md',
  'docs/roadmap.md', 'docs/security.md', 'docs/adr/README.md',
];
for (const name of required) {
  try {
    if (!(await stat(path.join(root, name))).isFile()) throw new Error('not a file');
  } catch {
    fail(path.join(root, name), '缺少必需文件');
  }
}

for (const file of await walk(root)) {
  const extension = path.extname(file);
  if (!['.md', '.json', '.yaml', '.yml', '.mjs'].includes(extension)) continue;
  const content = await readFile(file, 'utf8');
  if (content.includes('\r')) fail(file, '请使用 LF 行尾');
  if (!content.endsWith('\n')) fail(file, '缺少文件末尾换行');
  if (extension === '.json') {
    try { JSON.parse(content); } catch { fail(file, 'JSON 语法无效'); }
  }
  if (extension === '.md') await checkMarkdown(file, content);
}

const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (!manifest.private) fail(path.join(root, 'package.json'), '仓库根包必须为 private');
if (!/^pnpm@\d+\.\d+\.\d+$/.test(manifest.packageManager ?? '')) {
  fail(path.join(root, 'package.json'), 'packageManager 需要固定 pnpm 精确版本');
}
for (const forbidden of ['AGENDS.md', 'package-lock.json', 'yarn.lock']) {
  try {
    await stat(path.join(root, forbidden));
    fail(path.join(root, forbidden), '不应存在重复规则文件或其他包管理器锁文件');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`检查通过：${markdownCount} 个 Markdown 文件、必需文件、JSON、相对链接、代码围栏与行尾。`);
}
