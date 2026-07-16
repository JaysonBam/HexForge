import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const helperRoot = path.resolve(import.meta.dirname, '..');
const rendererSource = path.join(helperRoot, 'src', 'renderer');
const rendererOutput = path.join(helperRoot, 'dist', 'helper', 'src', 'renderer');

await mkdir(rendererOutput, { recursive: true });
await Promise.all(['settings.html', 'settings.css'].map((filename) =>
  copyFile(path.join(rendererSource, filename), path.join(rendererOutput, filename))));

// Remove stale source maps if a previous local compiler configuration emitted them.
await rm(path.join(rendererOutput, 'settings.js.map'), { force: true });
