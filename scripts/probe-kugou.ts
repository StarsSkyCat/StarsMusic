import { DirectKugouTransport, kugouProtocolBaseline } from '../packages/providers/src/kugou/transport.ts';
import { normalizeError } from '../packages/contracts/src/errors.ts';
import { record } from '../packages/contracts/src/validation.ts';

// 显式匿名联网验证，不显示挑战、设备标识、原始响应或凭据。不替代实际扫码。
const transport = new DirectKugouTransport();
try {
  const signal = AbortSignal.timeout(25000);
  const device = record(await transport.call('register', {}, signal), 'probe.device');
  if (device.status !== 1) throw new Error('device rejected');
  const body = record(await transport.call('qrKey', {}, signal), 'probe.qr');
  const data = record(body.data, 'probe.qr.data');
  if (body.status !== 1 || typeof data.qrcode !== 'string' || !data.qrcode) throw new Error('QR rejected');
  const poll = record(await transport.call('qrPoll', { key: data.qrcode }, signal), 'probe.poll');
  if (poll.status !== 1 || record(poll.data, 'probe.poll.data').status !== 1) throw new Error('poll rejected');
  console.log(`匿名端点通过：${kugouProtocolBaseline}；设备注册、标准版扫码挑战及等待扫码状态已验证，未登录账号。`);
} catch (error: unknown) {
  console.error(`匿名端点探测失败：${normalizeError(error).code}；不展示原始响应。`); process.exitCode = 1;
} finally { transport.clear(); }
