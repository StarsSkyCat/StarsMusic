import { DirectNeteaseTransport, neteaseProtocolBaseline } from '../packages/providers/src/netease/transport.ts';
import { normalizeError } from '../packages/contracts/src/errors.ts';
import { record } from '../packages/contracts/src/validation.ts';

// 显式执行的匿名联网探测，不输出 key、二维码、响应原文、Cookie 或媒体地址。
const transport = new DirectNeteaseTransport();
try {
  const body = record(await transport.call('qrKey', { type: 3 }, AbortSignal.timeout(12000)), 'probe.response');
  if (body.code !== 200 || typeof body.unikey !== 'string' || !body.unikey) throw new Error('invalid response');
  console.log(`匿名端点通过：${neteaseProtocolBaseline}；二维码 key 已返回（不展示），未登录账号。`);
} catch (error: unknown) {
  console.error(`匿名端点探测失败：${normalizeError(error).code}；没有输出原始响应。`);
  process.exitCode = 1;
} finally { transport.clear(); }
