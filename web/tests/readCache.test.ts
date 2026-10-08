import assert from 'node:assert/strict';
import test from 'node:test';
import { ReadCache } from '../src/lib/readCache.ts';

test('read cache deduplicates pending reads and expires after completion', async () => {
  let time = 0, reads = 0;
  const cache = new ReadCache<number>(10, 2, () => time);
  const load = async () => ++reads;
  const first = cache.read('account-a:project', load);
  assert.equal(cache.read('account-a:project', load), first);
  assert.equal(await first, 1);
  assert.equal(await cache.read('account-b:project', load), 2);
  time = 11;
  assert.equal(await cache.read('account-a:project', load), 3);
});

test('cache invalidation, force refresh and failed reads never reuse stale results', async () => {
  const cache = new ReadCache<number>();
  let reads = 0;
  assert.equal(await cache.read('a', async () => ++reads), 1);
  assert.equal(await cache.read('a', async () => ++reads, true), 2);
  cache.clear();
  assert.equal(await cache.read('a', async () => ++reads), 3);
  await assert.rejects(cache.read('bad', async () => { throw new Error('offline'); }), /offline/);
  assert.equal(await cache.read('bad', async () => 42), 42);
});

test('an invalidated in-flight result cannot replace a newer cached result', async () => {
  const cache = new ReadCache<number>();
  let finishOld!: (value: number) => void;
  const old = cache.read('account:project', () => new Promise(resolve => { finishOld = resolve; }));
  await Promise.resolve();
  cache.clear();
  assert.equal(await cache.read('account:project', async () => 2), 2);
  finishOld(1);
  assert.equal(await old, 1);
  assert.equal(await cache.read('account:project', async () => 3), 2);
});

test('long sessions evict old project results while retaining recent entries', async () => {
  const cache = new ReadCache<number>(60_000, 2);
  await cache.read('first', async () => 1);
  await cache.read('second', async () => 2);
  await cache.read('third', async () => 3);
  assert.equal(await cache.read('second', async () => 20), 2);
  assert.equal(await cache.read('first', async () => 10), 10);
});
