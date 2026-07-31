import { createReadStream, createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { dialog } from 'electron';
import type { CopyOperation } from '../../../shared/localHelperProtocol.js';
import type { ConfigStore } from './config.js';

const compoundExtension = (filename: string) => filename.toLocaleLowerCase().endsWith('.gcode.3mf') ? '.gcode.3mf' : path.extname(filename);

const renamedDestination = async (directory: string, filename: string): Promise<string> => {
  const extension = compoundExtension(filename);
  const base = filename.slice(0, filename.length - extension.length);
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = path.join(directory, `${base} (${index})${extension}`);
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error('Could not create a unique destination filename.');
};

export class CopyOperationManager {
  private readonly operations = new Map<string, CopyOperation>();

  constructor(
    private readonly configStore: ConfigStore,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

  start(sourcePath: string, totalBytes: number): CopyOperation {
    const operation: CopyOperation = {
      operationId: randomUUID(),
      status: 'awaiting_destination',
      bytesCopied: 0,
      totalBytes
    };
    this.operations.set(operation.operationId, operation);
    void this.run(operation.operationId, sourcePath);
    return { ...operation };
  }

  get(operationId: string): CopyOperation | null {
    const operation = this.operations.get(operationId);
    return operation ? { ...operation } : null;
  }

  private update(operationId: string, updates: Partial<CopyOperation>): void {
    const current = this.operations.get(operationId);
    if (current) this.operations.set(operationId, { ...current, ...updates });
  }

  private async run(operationId: string, sourcePath: string): Promise<void> {
    try {
      const config = this.configStore.get();
      const pickerOptions: Electron.OpenDialogOptions = {
        title: 'Choose printer media or destination folder',
        defaultPath: config.lastCopyDestination ?? undefined,
        properties: ['openDirectory', 'createDirectory']
      };
      const owner = this.getWindow();
      const result = owner ? await dialog.showOpenDialog(owner, pickerOptions) : await dialog.showOpenDialog(pickerOptions);
      if (result.canceled || !result.filePaths[0]) {
        this.update(operationId, { status: 'cancelled' });
        return;
      }
      const destinationDirectory = result.filePaths[0];
      await mkdir(destinationDirectory, { recursive: true });
      await this.configStore.update({ lastCopyDestination: destinationDirectory });
      let destinationPath = path.join(destinationDirectory, path.basename(sourcePath));
      let destinationExists = true;
      try {
        await access(destinationPath);
      } catch {
        destinationExists = false;
      }
      if (destinationExists) {
        const conflictOptions: Electron.MessageBoxOptions = {
          type: 'question',
          title: 'File already exists',
          message: `${path.basename(destinationPath)} already exists.`,
          detail: 'Choose whether to overwrite it, create a renamed copy, or cancel.',
          buttons: ['Overwrite', 'Create renamed copy', 'Cancel'],
          defaultId: 1,
          cancelId: 2,
          noLink: true
        };
        const conflictOwner = this.getWindow();
        const choice = conflictOwner
          ? await dialog.showMessageBox(conflictOwner, conflictOptions)
          : await dialog.showMessageBox(conflictOptions);
        if (choice.response === 2) {
          this.update(operationId, { status: 'cancelled' });
          return;
        }
        if (choice.response === 1) destinationPath = await renamedDestination(destinationDirectory, path.basename(sourcePath));
      }

      this.update(operationId, { status: 'copying', destinationName: path.basename(destinationPath) });
      const readStream = createReadStream(sourcePath);
      readStream.on('data', (chunk) => {
        const current = this.operations.get(operationId);
        this.update(operationId, { bytesCopied: Math.min((current?.bytesCopied ?? 0) + Buffer.byteLength(chunk), current?.totalBytes ?? 0) });
      });
      await pipeline(readStream, createWriteStream(destinationPath, { flags: 'w' }));
      const [sourceStats, destinationStats] = await Promise.all([stat(sourcePath), stat(destinationPath)]);
      if (sourceStats.size !== destinationStats.size) {
        throw new Error('The copied file size does not match the source file.');
      }
      this.update(operationId, {
        status: 'completed',
        bytesCopied: sourceStats.size,
        totalBytes: sourceStats.size,
        destinationName: path.basename(destinationPath)
      });
    } catch (error) {
      this.update(operationId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Copy failed.'
      });
    }
  }
}

// Kept exported for deterministic tests of the final verification path.
export const copyAndVerify = async (sourcePath: string, destinationPath: string): Promise<void> => {
  await copyFile(sourcePath, destinationPath);
  const [sourceStats, destinationStats] = await Promise.all([stat(sourcePath), stat(destinationPath)]);
  if (sourceStats.size !== destinationStats.size) throw new Error('Copied file size mismatch.');
};
