import { spawn } from 'node:child_process';
export async function isolatedSessionBus(runtimeDirectory: string): Promise<{ address: string; close(): Promise<void> }> {
  const child = spawn('dbus-daemon', ['--session', '--nofork', '--nopidfile', '--print-address=1'], { env: { ...process.env, XDG_RUNTIME_DIR: runtimeDirectory }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.resume();
  const exited = new Promise<void>(resolve => { child.once('close', () => resolve()); });
  const address = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('隔离测试 D-Bus 启动超时')); }, 5000); let buffer = '';
    child.once('error', () => { clearTimeout(timer); reject(new Error('无法启动隔离测试 D-Bus')); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('隔离测试 D-Bus 提前退出')); });
    child.stdout.setEncoding('utf8'); child.stdout.on('data', (data: string) => {
      buffer += data; if (!buffer.includes('\n')) return; const first = buffer.split('\n')[0]!;
      clearTimeout(timer); if (!first.startsWith('unix:') || first.length > 4096) reject(new Error('隔离测试 D-Bus 地址无效')); else resolve(first);
    });
  });
  return { address, async close() { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited; } };
}
