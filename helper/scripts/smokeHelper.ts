import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { LOCAL_HELPER_CLIENT_HEADER, LOCAL_HELPER_CLIENT_VALUE, LOCAL_HELPER_IDEMPOTENCY_HEADER } from '../../shared/localHelperProtocol.ts';
import { ConfigStore } from '../src/main/config.ts';

const availablePort = () => new Promise<number>((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('Could not allocate a smoke-test port.'));
    server.close(() => resolve(address.port));
  });
});

const appData = await mkdtemp(path.join(os.tmpdir(), 'printing-manager-helper-appdata-'));
const root = await mkdtemp(path.join(os.tmpdir(), 'printing-manager-helper-root-'));
const port = await availablePort();
const configStore = new ConfigStore(appData);
const baseConfig = await configStore.load();
await configStore.save({
  ...baseConfig,
  rootProjectFolder: root,
  port,
  allowedOrigins: ['http://localhost:5173']
});

const executable = path.resolve('release', 'win-unpacked', 'Printing Manager Helper.exe');
await access(executable);
const child = spawn(executable, ['--background'], {
  env: { ...process.env, PRINTING_MANAGER_HELPER_APPDATA: appData },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
});
let childOutput = '';
child.stdout.on('data', (chunk) => { childOutput += chunk.toString(); });
child.stderr.on('data', (chunk) => { childOutput += chunk.toString(); });

const headers = {
  Origin: 'http://localhost:5173',
  [LOCAL_HELPER_CLIENT_HEADER]: LOCAL_HELPER_CLIENT_VALUE
};

const waitForHealth = async () => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged helper exited with code ${child.exitCode}. ${childOutput}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/health`, { headers });
      if (response.ok) return response.json() as Promise<Record<string, unknown>>;
    } catch {
      // Portable app startup can take several seconds on first launch.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Packaged helper did not expose health in time. ${childOutput}`);
};

const post = async (route: string, body: unknown) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      [LOCAL_HELPER_IDEMPOTENCY_HEADER]: randomUUID()
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Smoke request ${route} failed: ${JSON.stringify(payload)}`);
  return payload;
};

try {
  const health = await waitForHealth();
  const descriptor = {
    projectId: 'SMOKE',
    priorityNumber: 107,
    studentName: 'Smoke Test',
    studentNumber: '12345678',
    module: 'COS110'
  };
  const created = await post('/v1/projects/create', { project: descriptor });
  const folderName = String(created.folderName);
  const projectKey = String(created.projectKey);
  const folderPath = path.join(root, folderName);
  await mkdir(folderPath, { recursive: true });
  await Promise.all([
    writeFile(path.join(folderPath, 'model.stl'), 'solid smoke\nendsolid smoke\n'),
    writeFile(path.join(folderPath, 'print.gcode'), '; smoke gcode\n'),
    writeFile(path.join(folderPath, 'plate.gcode.3mf'), 'smoke fixture'),
    writeFile(path.join(folderPath, 'plate.ufp'), 'smoke fixture')
  ]);
  const filesResponse = await fetch(`http://127.0.0.1:${port}/v1/projects/${projectKey}/files`, { headers });
  const files = await filesResponse.json() as { totalFiles?: number; counts?: unknown };
  if (!filesResponse.ok || files.totalFiles !== 4) throw new Error(`Expected four supported files, received ${JSON.stringify(files)}.`);
  const renamed = await post(`/v1/projects/${projectKey}/status`, { status: 'collected' });
  const rootEntries = await import('node:fs/promises').then(({ readdir }) => readdir(root));
  if (!rootEntries.some((entry) => entry.endsWith(' - collected'))) throw new Error('Collected folder suffix was not applied.');
  process.stdout.write(`${JSON.stringify({ health, created, files, renamed, executable }, null, 2)}\n`);
} finally {
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
  await Promise.all([rm(appData, { recursive: true, force: true }), rm(root, { recursive: true, force: true })]);
}
