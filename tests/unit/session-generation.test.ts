import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '../../packages/contracts/src/errors.ts';
import { contextKey } from '../../packages/contracts/src/music.ts';
import { SessionGeneration } from '../../packages/providers/src/session-generation.ts';

const accountA = { provider: 'kugou', clientChannel: 'kugou-web', accountId: 'account-a' } as const;
const accountB = { ...accountA, accountId: 'account-b' } as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('切账号取消旧请求，即使上游忽略取消并晚返回也不能写入缓存', async () => {
  const sessions = new SessionGeneration();
  const old = sessions.activate(accountA);
  const pending = deferred<string>();
  const cache = new Map<string, string>();
  const oldRequest = sessions.run(old, (signal) => {
    assert.equal(signal, old.signal);
    return pending.promise;
  }, (value) => { cache.set(contextKey(old.context), value); });
  const current = sessions.activate(accountB);
  assert.equal(old.signal.aborted, true);
  assert.equal(current.signal.aborted, false);
  assert.equal(await sessions.run(current, async () => 'new-result', (value) => { cache.set(contextKey(current.context), value); }).then((result) => result.status), 'applied');
  pending.resolve('old-result');
  assert.deepEqual(await oldRequest, { status: 'discarded' });
  assert.deepEqual([...cache], [[contextKey(current.context), 'new-result']]);
});

test('退出、重登同一账号和切换渠道均不会复用旧 generation', async () => {
  const sessions = new SessionGeneration();
  const first = sessions.activate(accountA);
  sessions.invalidate('kugou');
  assert.equal(first.signal.aborted, true);
  const second = sessions.activate(accountA);
  assert.ok(second.generation > first.generation);
  assert.equal(sessions.commit(first, () => assert.fail('旧回调不应执行')), false);
  const appChannel = sessions.activate({ ...accountA, clientChannel: 'kugou-app' });
  assert.ok(appChannel.generation > second.generation);
  assert.equal(second.signal.aborted, true);
  let started = false;
  assert.deepEqual(await sessions.run(second, async () => { started = true; }, () => undefined), { status: 'discarded' });
  assert.equal(started, false);
});

test('平台 generation 独立，退出酷狗不影响网易云；伪造或其他服务的 lease 无效', () => {
  const sessions = new SessionGeneration();
  const kugou = sessions.activate(accountA);
  const netease = sessions.activate({ provider: 'netease', clientChannel: 'netease-app', accountId: 'account-a' });
  sessions.invalidate('kugou');
  assert.equal(sessions.isCurrent(kugou), false);
  assert.equal(sessions.isCurrent(netease), true);
  assert.equal(sessions.isCurrent({ ...netease }), false);
  assert.equal(new SessionGeneration().isCurrent(netease), false);
  assert.ok(Object.isFrozen(netease));
  assert.ok(Object.isFrozen(netease.context));
  assert.throws(() => sessions.activate({ provider: 'local' }));
  assert.throws(() => sessions.activate({ ...accountA, clientChannel: 'netease-app' }));
  assert.equal(sessions.isCurrent(netease), true);
});

test('过期失败也丢弃，当前错误安全归一化且不执行写回', async () => {
  const sessions = new SessionGeneration();
  const old = sessions.activate(accountA);
  const pending = deferred<string>();
  const request = sessions.run(old, () => pending.promise, () => assert.fail('失败不能回写'));
  sessions.activate(accountB);
  pending.reject(new DomainError('session-expired'));
  assert.deepEqual(await request, { status: 'discarded' });
  const current = sessions.activate(accountB);
  const result = await sessions.run(current, async () => { throw new DomainError('network'); }, () => assert.fail('失败不能回写'));
  assert.equal(result.status, 'failed');
  if (result.status === 'failed') assert.equal(result.error.code, 'network');
});

test('abort 同步监听器重入时，外层 activate 不会覆盖更新的会话', () => {
  const sessions = new SessionGeneration();
  const first = sessions.activate(accountA);
  let newest = first;
  let oldCommitted = true;
  first.signal.addEventListener('abort', () => {
    oldCommitted = sessions.commit(first, () => assert.fail('abort 中的旧回写不应执行'));
    newest = sessions.activate({ ...accountA, clientChannel: 'kugou-app' });
  }, { once: true });
  const middle = sessions.activate(accountB);
  assert.equal(oldCommitted, false);
  assert.equal(middle.signal.aborted, true);
  assert.equal(sessions.isCurrent(middle), false);
  assert.equal(sessions.isCurrent(newest), true);
});
