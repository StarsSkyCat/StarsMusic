import { execFile } from 'node:child_process';
import { readFile, readlink } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export async function mpvProcesses(parentPid = process.pid): Promise<{ pid: number; commandLine: string }[]> {
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) throw new Error('test.invalid-pid');
  if (process.platform === 'win32') {
    // 只查询本次测试的直接 mpv 子进程，不结束或读取其他应用。
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${parentPid} AND Name='mpv.exe'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`],
    { windowsHide: true, timeout: 10_000 });
    if (!stdout.trim()) return [];
    const raw: unknown = JSON.parse(stdout);
    return (Array.isArray(raw) ? raw : [raw]).map((item: unknown) => {
      if (typeof item !== 'object' || item === null || typeof Reflect.get(item, 'ProcessId') !== 'number' || typeof Reflect.get(item, 'CommandLine') !== 'string') throw new Error('test.invalid-process');
      return { pid: Reflect.get(item, 'ProcessId') as number, commandLine: Reflect.get(item, 'CommandLine') as string };
    });
  }
  const pids = (await readFile(`/proc/${parentPid}/task/${parentPid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean);
  const result: { pid: number; commandLine: string }[] = [];
  for (const pid of pids) {
    try {
      if ((await readlink(`/proc/${pid}/exe`)).endsWith('/mpv')) result.push({ pid: Number(pid), commandLine: await readFile(`/proc/${pid}/cmdline`, 'utf8') });
    } catch { /* 查询期间已退出。 */ }
  }
  return result;
}
