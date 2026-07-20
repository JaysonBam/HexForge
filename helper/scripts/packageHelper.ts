import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

const workspaceRoot = path.resolve(import.meta.dirname, '..', '..');
const helperRoot = path.join(workspaceRoot, 'helper');
const releaseRoot = path.join(workspaceRoot, 'release');
// Use a per-build directory. Antivirus/indexing can briefly retain handles to a
// previous Electron output directory, which must not prevent the next build.
const stagingRoot = path.join(tmpdir(), `PrintingManagerHelper-build-${process.pid}`);
const artifactName = 'PrintingManagerHelper.exe';
const builderCli = path.join(workspaceRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });

let packaged = false;

try {
  const result = spawnSync(process.execPath, [
    builderCli,
    '--projectDir', helperRoot,
    '--config', path.join(helperRoot, 'electron-builder.yml'),
    '--config.directories.output', stagingRoot,
    '--win',
    'portable'
  ], {
    cwd: workspaceRoot,
    env: process.env,
    stdio: 'inherit'
  });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`electron-builder exited with code ${result.status ?? 'unknown'}.`);

  await mkdir(releaseRoot, { recursive: true });

  // A portable Electron app keeps both the launcher and its extracted product
  // processes open. Stop both helper-owned image names before replacing the
  // release artifact so an older extracted process cannot keep serving the port.
  if (process.platform === 'win32') {
    for (const imageName of [artifactName, 'Printing Manager Helper.exe']) {
      spawnSync('taskkill.exe', ['/F', '/T', '/IM', imageName], { stdio: 'ignore' });
    }
    await setTimeout(500);
  }

  const stagedArtifact = path.join(stagingRoot, artifactName);
  const releaseArtifact = path.join(releaseRoot, artifactName);
  const incomingArtifact = path.join(releaseRoot, `${artifactName}.incoming-${process.pid}`);
  await copyFile(stagedArtifact, incomingArtifact);

  let replacementError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(releaseArtifact, { force: true });
      await rename(incomingArtifact, releaseArtifact);
      replacementError = undefined;
      break;
    } catch (error) {
      replacementError = error;
      await setTimeout(500);
    }
  }
  if (replacementError) throw replacementError;

  packaged = true;
  console.log(`Packaged helper: ${releaseArtifact}`);
} finally {
  if (packaged) {
    await rm(stagingRoot, { recursive: true, force: true });
  } else {
    console.error(`Packaging output was preserved for recovery: ${stagingRoot}`);
  }
}
