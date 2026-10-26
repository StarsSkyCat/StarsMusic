import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTrustedInvoke, getDevelopmentUrl } from '../../src/main/ipc-policy.ts';
import { parseAppInfo } from '../../packages/contracts/src/desktop.ts';

test('IPC 仅接受指定窗口的精确主文档，拒绝子帧、其他窗口和导航后文档', () => {
  const sender = {};
  const frame = { url: 'file:///app/index.html' };
  const source = { sender, senderFrame: frame };
  const check = (input: typeof source) => assertTrustedInvoke(input, sender, frame, frame.url, []);
  assert.doesNotThrow(() => check(source));
  assert.throws(() => check({ ...source, sender: {} }), /来源/);
  assert.throws(() => check({ ...source, senderFrame: { ...frame } }), /来源/);
  assert.throws(() => assertTrustedInvoke(source, sender, frame, 'file:///other.html', []), /来源/);
  assert.throws(() => assertTrustedInvoke({ sender, senderFrame: null }, sender, frame, frame.url, []), /来源/);
  assert.throws(() => assertTrustedInvoke(source, undefined, undefined, frame.url, []), /来源/);
  assert.throws(() => assertTrustedInvoke(source, sender, frame, frame.url, ['unexpected']), /参数/);
});

test('开发页面限定 loopback 精确地址，拒绝远端、伪造主机、凭据及路径', () => {
  assert.equal(getDevelopmentUrl(undefined), undefined);
  assert.equal(getDevelopmentUrl('http://127.0.0.1:5173'), 'http://127.0.0.1:5173/');
  for (const url of [
    '', 'https://127.0.0.1:5173/', 'http://localhost:5173/',
    'http://127.0.0.1.evil.invalid:5173/', 'http://127.0.0.1:5174/',
    'http://127.0.0.1:5173/other', 'http://127.0.0.1:5173/?x=1',
    'http://127.0.0.1:5173/#other', 'http://user:pass@127.0.0.1:5173/',
  ]) assert.throws(() => getDevelopmentUrl(url), url);
});

test('后台信息必须经过运行时校验，额外字段不会被投影到界面', () => {
  const info = {
    name: 'StarsMusic', version: '0.0.0', platform: 'linux', arch: 'x64',
    electron: '45.0.0', chromium: 'test', node: '24.0.0',
  };
  assert.deepEqual(parseAppInfo({ ...info, extra: 'private-field' }), info);
  for (const value of [null, undefined, 'invalid', {}, { ...info, electron: 45 }, { ...info, node: '' }]) {
    assert.throws(() => parseAppInfo(value), /格式无效/);
  }
});
