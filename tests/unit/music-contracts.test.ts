import assert from 'node:assert/strict';
import test from 'node:test';
import { appError, DomainError, normalizeError, parseAppError } from '../../packages/contracts/src/errors.ts';
import {
  contextKey, parseLoginState, parseProviderContext, parseSessionStatus,
  parseStreamResolution, parseTrackRef,
} from '../../packages/contracts/src/music.ts';
import { ContractValidationError } from '../../packages/contracts/src/validation.ts';

test('曲目 ID 始终为字符串，投影会丢弃额外字段并保留版本标识', () => {
  const track = { provider: 'netease', id: '900719925474099312345', variant: 'live' };
  assert.deepEqual(parseTrackRef({ ...track, extra: 'not-public' }), track);
  for (const invalid of [null, [], {}, { ...track, id: 123 }, { ...track, id: '' }, { ...track, provider: 'other' }]) {
    assert.throws(() => parseTrackRef(invalid), ContractValidationError);
  }
  assert.ok(Object.isFrozen(parseTrackRef(track)));
});

test('上下文拒绝平台渠道混用，缓存键区分平台、账号、渠道和游客', () => {
  const contexts = [
    { provider: 'local' },
    { provider: 'netease', clientChannel: 'netease-app', accountId: 'account-a' },
    { provider: 'kugou', clientChannel: 'kugou-app', accountId: 'account-a' },
    { provider: 'kugou', clientChannel: 'kugou-web', accountId: 'account-a' },
    { provider: 'kugou', clientChannel: 'kugou-web', accountId: 'account-b' },
    { provider: 'kugou', clientChannel: 'kugou-web' },
    { provider: 'kugou', clientChannel: 'kugou-web', accountId: 'null' },
  ].map(parseProviderContext);
  assert.equal(new Set(contexts.map(contextKey)).size, contexts.length);
  for (const invalid of [
    { provider: 'kugou', clientChannel: 'netease-app' },
    { provider: 'netease', clientChannel: 'kugou-web' },
    { provider: 'kugou' },
    { provider: 'local', accountId: 'account-a' },
    { provider: 'local', clientChannel: 'kugou-web' },
    { provider: 'netease', clientChannel: 'netease-app', accountId: 12 },
  ]) assert.throws(() => parseProviderContext(invalid), ContractValidationError);
});

test('登录契约要求身份验证、账号与时间一致，等待授权不是已连接', () => {
  const context = { provider: 'kugou', clientChannel: 'kugou-web', accountId: 'account-a' };
  const login = { status: 'connected', identityVerified: true, lastVerifiedAt: 1000, expiresAt: 2000 };
  const valid = { context, generation: 2, login };
  assert.deepEqual(parseSessionStatus(valid), valid);
  for (const status of ['waiting-scan', 'waiting-authorization', 'awaiting-confirmation', 'verifying']) {
    assert.equal(parseLoginState({ status, challengeId: 'test-challenge' }).status, status);
    assert.throws(() => parseLoginState({ status }), ContractValidationError);
  }
  for (const status of ['signed-out', 'expired', 'cancelled']) assert.deepEqual(parseLoginState({ status }), { status });
  for (const invalid of [
    { ...valid, context: { provider: 'kugou', clientChannel: 'kugou-web' } },
    { ...valid, login: { ...login, identityVerified: false } },
    { ...valid, login: { ...login, expiresAt: 1000 } },
    { ...valid, login: { status: 'signed-out' } },
    { ...valid, generation: -1 }, { ...valid, generation: 1.5 },
    { ...valid, generation: Number.MAX_SAFE_INTEGER + 1 },
  ]) assert.throws(() => parseSessionStatus(invalid), ContractValidationError);
});

// 纯合成资源，无平台响应、凭据或带签名的 URL。
const remoteStream = {
  track: { provider: 'netease', id: 'test-track' },
  source: { kind: 'remote', url: 'https://media.example.invalid/audio', headers: {} },
  quality: { level: 'unknown' },
  access: { kind: 'preview', startMs: 0, durationMs: 30_000 },
};

test('流解析区分本地资源、在线资源和试听，不从登录状态推断可播放权限', () => {
  const parsed = parseStreamResolution(remoteStream);
  assert.deepEqual(parsed.access, remoteStream.access);
  assert.deepEqual(parsed.quality, { level: 'unknown' });
  const local = {
    track: { provider: 'local', id: 'file-a' }, source: { kind: 'local', fileId: 'file-a' },
    quality: { level: 'lossless', codec: 'flac', sampleRateHz: 44100 }, access: { kind: 'full' },
  };
  assert.deepEqual(parseStreamResolution(local), local);
  for (const invalid of [
    { ...local, source: { kind: 'local', fileId: 'file-b' } },
    { ...remoteStream, track: local.track },
    { ...remoteStream, source: local.source },
    { ...remoteStream, access: { kind: 'preview', startMs: -1, durationMs: 100 } },
    { ...remoteStream, access: { kind: 'preview', startMs: 0, durationMs: 0 } },
    { ...remoteStream, quality: { level: 'unknown', bitrateKbps: Infinity } },
    { ...remoteStream, quality: { level: 'unknown', sampleRateHz: NaN } },
  ]) assert.throws(() => parseStreamResolution(invalid), ContractValidationError);
});

test('远端流拒绝危险协议、URL 内嵌身份、请求头注入和冲突头', () => {
  const invalidSources: unknown[] = [
    { ...remoteStream.source, url: 'file:///tmp/audio' },
    { ...remoteStream.source, url: 'http://media.example.invalid/audio' },
    { ...remoteStream.source, url: 'https://guest@media.example.invalid/audio' },
    { ...remoteStream.source, url: 'https://media.example.invalid/audio#fragment' },
    { ...remoteStream.source, url: 'https://media.example.invalid/audio\n' },
    { ...remoteStream.source, headers: { 'X-Test': 'one\r\nInjected: two' } },
    { ...remoteStream.source, headers: { 'X-Test': 'one\u0001two' } },
    { ...remoteStream.source, headers: { 'X-Test': 'one', 'x-test': 'two' } },
    { ...remoteStream.source, headers: { Host: 'other.example.invalid' } },
    { ...remoteStream.source, headers: { 'Invalid Name': 'value' } },
    { ...remoteStream.source, headers: { 'X-Test': 1 } },
    { ...remoteStream.source, expiresAt: -1 },
  ];
  for (const source of invalidSources) {
    assert.throws(() => parseStreamResolution({ ...remoteStream, source }), ContractValidationError);
  }
  const parsed = parseStreamResolution({ ...remoteStream, source: { ...remoteStream.source, headers: { Accept: 'audio/*' } } });
  assert.equal(parsed.source.kind, 'remote');
  if (parsed.source.kind === 'remote') {
    assert.equal(parsed.source.headers.accept, 'audio/*');
    assert.ok(Object.isFrozen(parsed.source.headers));
  }
});

test('归一化错误不传播远端内容、堆栈或未经确认的权限分类', () => {
  const marker = 'synthetic-private-marker';
  const safe = normalizeError(new Error(marker));
  assert.deepEqual(safe, appError('internal'));
  assert.ok(!JSON.stringify(safe).includes(marker));
  assert.equal(normalizeError({ code: 'permission-denied', message: marker }).code, 'internal');
  assert.equal(normalizeError(new DomainError('permission-denied')).code, 'permission-denied');
  assert.equal(normalizeError(new ContractValidationError('track.id')).code, 'invalid-response');
  assert.equal(normalizeError(Object.assign(new Error(marker), { name: 'AbortError' })).code, 'cancelled');
  assert.equal(normalizeError(Object.assign(new Error(marker), { name: 'TimeoutError' })).code, 'timeout');
  assert.deepEqual(parseAppError({ code: 'network', message: marker, retryable: false }), appError('network'));
  assert.deepEqual(parseLoginState({ status: 'failed', error: { code: 'network', message: marker } }), { status: 'failed', error: appError('network') });
  assert.throws(() => parseAppError({ code: 'unknown-platform-code' }), ContractValidationError);
});
