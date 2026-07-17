import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LOCAL_HELPER_CLIENT_HEADER, LOCAL_HELPER_CLIENT_VALUE } from '../shared/localHelperProtocol.ts';
import { LocalApiServer } from '../helper/src/main/apiServer.ts';
import { ConfigStore } from '../helper/src/main/config.ts';
import { RotatingLogger } from '../helper/src/main/logger.ts';
import { OpaqueRegistry } from '../helper/src/main/registry.ts';

const availablePort = () => new Promise<number>((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('No TCP port available.'));
    server.close(() => resolve(address.port));
  });
});

test('helper API enforces deployed/dev CORS, PNA preflight, and the custom header', async () => {
  const appData = await mkdtemp(path.join(os.tmpdir(), 'hexforge-api-appdata-'));
  const root = await mkdtemp(path.join(os.tmpdir(), 'hexforge-api-root-'));
  const workflowFolders = {
    to_be_printed: path.join(root, 'To Be Printed'),
    currently_printing: path.join(root, 'Currently Printing'),
    completed_prints: path.join(root, 'Completed Prints'),
    do_not_print: path.join(root, 'Do Not Print')
  };
  await Promise.all(Object.values(workflowFolders).map((folder) => mkdir(folder)));
  const port = await availablePort();
  const configStore = new ConfigStore(appData);
  const config = await configStore.load();
  await configStore.save({
    ...config,
    workflowFolders,
    port,
    allowedOrigins: ['https://printing.example.com', 'http://localhost:5173']
  });
  const logger = new RotatingLogger(appData);
  let openedFolder: string | null = null;
  const server = new LocalApiServer({
    configStore,
    registry: new OpaqueRegistry(),
    logger,
    copyOperations: { start: () => { throw new Error('not used'); }, get: () => null } as never,
    openFile: async () => undefined,
    openFolder: async (folderPath) => { openedFolder = folderPath; },
    openSettings: () => undefined
  });
  await server.start();
  try {
    for (const origin of ['https://printing.example.com', 'http://localhost:5173']) {
      const preflight = await fetch(`http://127.0.0.1:${port}/v1/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': LOCAL_HELPER_CLIENT_HEADER,
          'Access-Control-Request-Private-Network': 'true'
        }
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
      assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
    }
    const missingHeader = await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: { Origin: 'https://printing.example.com' } });
    assert.equal(missingHeader.status, 403);
    const connected = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      headers: { Origin: 'https://printing.example.com', [LOCAL_HELPER_CLIENT_HEADER]: LOCAL_HELPER_CLIENT_VALUE }
    });
    assert.equal(connected.status, 200);
    const projectHeaders = {
      Origin: 'http://localhost:5173',
      [LOCAL_HELPER_CLIENT_HEADER]: LOCAL_HELPER_CLIENT_VALUE,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': crypto.randomUUID()
    };
    const descriptor = { projectId: 'ABCDE', priorityNumber: 107, studentName: 'API Test', studentNumber: '12345678', expectedWorkflowFolder: 'to_be_printed', expectTbc: true };
    const created = await fetch(`http://127.0.0.1:${port}/v1/projects/create`, {
      method: 'POST',
      headers: projectHeaders,
      body: JSON.stringify({ project: descriptor })
    });
    assert.equal(created.status, 200);
    const createdProject = await created.json() as { projectKey: string };
    const opened = await fetch(`http://127.0.0.1:${port}/v1/projects/${createdProject.projectKey}/open-folder`, {
      method: 'POST',
      headers: { ...projectHeaders, 'X-Idempotency-Key': crypto.randomUUID() },
      body: '{}'
    });
    assert.equal(opened.status, 200);
    assert.ok(openedFolder?.endsWith('P107 API Test u12345678 - TBC'));
    const synchronized = await fetch(`http://127.0.0.1:${port}/v1/projects/${createdProject.projectKey}/sync`, {
      method: 'POST',
      headers: { ...projectHeaders, 'X-Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ project: { ...descriptor, expectedWorkflowFolder: 'currently_printing', expectTbc: false } })
    });
    assert.equal(synchronized.status, 200);
    await access(path.join(workflowFolders.currently_printing, 'P107 API Test u12345678'));
    const rejected = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      headers: { Origin: 'https://attacker.example', [LOCAL_HELPER_CLIENT_HEADER]: LOCAL_HELPER_CLIENT_VALUE }
    });
    assert.equal(rejected.status, 403);
  } finally {
    await server.stop();
  }
});
