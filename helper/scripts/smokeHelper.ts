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
const workflowFolders = {
  to_be_printed: path.join(root, 'To Be Printed'),
  currently_printing: path.join(root, 'Currently Printing'),
  completed_prints: path.join(root, 'Completed Prints'),
  do_not_print: path.join(root, 'Do Not Print')
};
await Promise.all(Object.values(workflowFolders).map((folder) => mkdir(folder)));
const port = await availablePort();
const configStore = new ConfigStore(appData);
const baseConfig = await configStore.load();
await configStore.save({
  ...baseConfig,
  workflowFolders,
  port,
  allowedOrigins: ['http://localhost:5173']
});

const executable = path.resolve('release', 'PrintingManagerHelper.exe');
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
  const deadline = Date.now() + 60_000;
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
    expectedWorkflowFolder: 'to_be_printed' as const,
    expectTbc: true
  };
  const created = await post('/v1/projects/create', { project: descriptor });
  const folderName = String(created.folderName);
  const projectKey = String(created.projectKey);
  const folderPath = path.join(workflowFolders.to_be_printed, folderName);
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
  const renamed = await post(`/v1/projects/${projectKey}/sync`, { project: { ...descriptor, expectedWorkflowFolder: 'completed_prints', expectTbc: false } });
  const completedEntries = await import('node:fs/promises').then(({ readdir }) => readdir(workflowFolders.completed_prints));
  if (!completedEntries.includes('P107 Smoke Test u12345678')) throw new Error('Completed folder move was not applied.');
  process.stdout.write(`${JSON.stringify({ health, created, files, renamed, executable }, null, 2)}\n`);
} finally {
  if (child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
  let cleanupError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await Promise.all([rm(appData, { recursive: true, force: true }), rm(root, { recursive: true, force: true })]);
      cleanupError = undefined;
      break;
    } catch (error) {
      cleanupError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (cleanupError) process.stderr.write(`Smoke-test temporary files remain for OS cleanup: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`);
}
