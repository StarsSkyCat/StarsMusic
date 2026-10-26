import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { allowedMediaAddress, allowedMediaUrl, MediaGateway, publicIpv4, type FetchMedia } from '../../packages/playback/src/media-gateway.ts';

test('媒体目标精确限定 HTTPS 网易云 CDN，拒绝私网/保留 IP 和伪造后缀', () => {
  assert.equal(allowedMediaUrl('https://m1.music.126.net/synthetic').hostname, 'm1.music.126.net');
  for (const url of ['http://m1.music.126.net/a', 'https://music.126.net.evil.invalid/a', 'https://127.0.0.1/a',
    'https://name@m1.music.126.net/a', 'https://m1.music.126.net:8443/a', 'https://m1.music.126.net/a\n']) {
    assert.throws(() => allowedMediaUrl(url));
  }
  assert.equal(publicIpv4('1.2.3.4'), true);
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.2', '169.254.169.254',
    '100.64.0.1', '192.0.2.1', '198.18.0.1', '203.0.113.1', '224.0.0.1', '::1', '1.2.3.']) assert.equal(publicIpv4(ip), false, ip);
  assert.equal(allowedMediaAddress('198.18.0.1'), true);
  assert.equal(allowedMediaAddress('198.19.255.254'), true);
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.2', '198.20.0.1.invalid', '::1']) assert.equal(allowedMediaAddress(ip), false);
});

test('实际 loopback 网关鉴别随机路径，转发单 Range，隔离所有调用者身份头与上游 Cookie', async () => {
  const received: Record<string, string>[] = [];
  const fetcher: FetchMedia = async (_target, headers) => {
    received.push(headers);
    return { status: headers.Range ? 206 : 200, headers: { 'content-type': 'audio/wav', 'content-length': '4', 'set-cookie': 'synthetic=not-forwarded' }, stream: Readable.from(['test']) };
  };
  const gateway = await MediaGateway.open('https://m1.music.126.net/synthetic', new AbortController().signal, fetcher);
  try {
    const invalid = new URL('/wrong-path', gateway.address);
    assert.equal((await fetch(invalid)).status, 404);
    assert.equal((await fetch(gateway.address, { method: 'POST' })).status, 405);
    assert.equal((await fetch(gateway.address, { headers: { Range: 'bytes=1-2,4-5' } })).status, 416);
    const response = await fetch(gateway.address, { headers: { Range: 'bytes=0-3', Cookie: 'synthetic=not-forwarded', Authorization: 'synthetic-not-forwarded' } });
    assert.equal(response.status, 206); assert.equal(await response.text(), 'test');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(received, [{ Accept: 'audio/*', Range: 'bytes=0-3' }]);
    const head = await fetch(gateway.address, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
  } finally { await gateway.close(); }
  await assert.rejects(fetch(gateway.address));
});

test('每次重定向重新校验目标，过界跳转不请求，取消立即关闭网关', async () => {
  const targets: string[] = [];
  const fetcher: FetchMedia = async (url) => {
    targets.push(url.hostname);
    return { status: 302, headers: { location: 'http://127.0.0.1/private' }, stream: Readable.from([]) };
  };
  const abort = new AbortController();
  const gateway = await MediaGateway.open('https://m1.music.126.net/synthetic', abort.signal, fetcher);
  try {
    assert.equal((await fetch(gateway.address)).status, 502);
    assert.deepEqual(targets, ['m1.music.126.net']);
    abort.abort();
    await assert.rejects(fetch(gateway.address));
  } finally { await gateway.close(); }
});

test('酷狗 CDN 按平台隔离，连同跨平台重定向一起拒绝', async () => {
  const url = 'https://fsandroid.kugou.com/synthetic';
  assert.equal(allowedMediaUrl(url, 'kugou').hostname, 'fsandroid.kugou.com');
  assert.throws(() => allowedMediaUrl(url, 'netease'));
  assert.throws(() => allowedMediaUrl('https://m1.music.126.net/synthetic', 'kugou'));
  for (const host of ['www.kugou.com', 'login-user.kugou.com', 'fsandroid.kugou.com.evil.invalid']) {
    assert.throws(() => allowedMediaUrl(`https://${host}/synthetic`, 'kugou'));
  }
  const targets: string[] = [];
  const fetcher: FetchMedia = async (target) => {
    targets.push(target.hostname);
    return { status: 302, headers: { location: 'https://m1.music.126.net/synthetic' }, stream: Readable.from([]) };
  };
  const gateway = await MediaGateway.open(url, new AbortController().signal, fetcher, 'kugou');
  try { assert.equal((await fetch(gateway.address)).status, 502); assert.deepEqual(targets, ['fsandroid.kugou.com']); }
  finally { await gateway.close(); }
});
