import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalHelperClient, LocalHelperError } from '../src/local-files/localHelperClient.ts';

const health = {
  apiVersion: 'v1',
  helperVersion: '1.0.0',
  state: 'connected',
  configured: true,
  rootAvailable: true,
  installationId: 'installation-1',
  port: 47821
};

test('web client reports a connected helper only after validating health', async () => {
  let targetAddressSpace: unknown;
  const fetcher = (async (_input: string | URL | Request, init?: RequestInit) => {
    targetAddressSpace = (init as RequestInit & { targetAddressSpace?: unknown } | undefined)?.targetAddressSpace;
    return new Response(JSON.stringify(health), { status: 200 });
  }) as typeof fetch;
  const client = new LocalHelperClient(47821, fetcher);
  assert.deepEqual(await client.health(), health);
  assert.equal(targetAddressSpace, 'loopback');
});

test('web client invokes browser fetch with the global receiver', async () => {
  let receiverWasGlobal = false;
  const fetcher = function (this: unknown) {
    receiverWasGlobal = this === globalThis;
    return Promise.resolve(new Response(JSON.stringify(health), { status: 200 }));
  } as typeof fetch;
  const client = new LocalHelperClient(47821, fetcher);
  assert.deepEqual(await client.health(), health);
  assert.equal(receiverWasGlobal, true);
});

test('web client treats connection failures quietly as unavailable errors', async () => {
  const fetcher = (async () => { throw new TypeError('connection refused'); }) as typeof fetch;
  const client = new LocalHelperClient(47821, fetcher);
  await assert.rejects(client.health(), (error: unknown) => error instanceof LocalHelperError && error.code === 'UNAVAILABLE');
});

test('web client rejects malformed helper responses', async () => {
  const fetcher = (async () => new Response(JSON.stringify({ connected: true }), { status: 200 })) as typeof fetch;
  const client = new LocalHelperClient(47821, fetcher);
  await assert.rejects(client.health(), (error: unknown) => error instanceof LocalHelperError && error.code === 'INVALID_RESPONSE');
});

test('web client aborts stale requests supplied by the caller', async () => {
  const fetcher = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  })) as typeof fetch;
  const client = new LocalHelperClient(47821, fetcher);
  const controller = new AbortController();
  const request = client.health(controller.signal);
  controller.abort();
  await assert.rejects(request, (error: unknown) => error instanceof LocalHelperError && error.code === 'TIMEOUT');
});
