import { mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_LOG_FILES = 5;

export class RotatingLogger {
  readonly directory: string;
  private readonly activePath: string;

  constructor(appDataDirectory: string) {
    this.directory = path.join(appDataDirectory, 'HexForgeFileHelper', 'logs');
    this.activePath = path.join(this.directory, 'helper.log');
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  async info(event: string, details: Record<string, unknown> = {}): Promise<void> {
    await this.write('INFO', event, details);
  }

  async error(event: string, details: Record<string, unknown> = {}): Promise<void> {
    await this.write('ERROR', event, details);
  }

  private async write(level: string, event: string, details: Record<string, unknown>): Promise<void> {
    await this.initialize();
    await this.rotateIfNeeded();
    const safeDetails = Object.fromEntries(Object.entries(details).filter(([key]) =>
      !['root', 'path', 'contents', 'authorization', 'token', 'credential'].includes(key.toLowerCase())));
    const line = `${JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...safeDetails })}\n`;
    await writeFile(this.activePath, line, { flag: 'a', encoding: 'utf8' });
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      if ((await stat(this.activePath)).size < MAX_LOG_BYTES) return;
    } catch {
      return;
    }

    for (let index = MAX_LOG_FILES - 1; index >= 1; index -= 1) {
      const source = index === 1 ? this.activePath : path.join(this.directory, `helper.${index - 1}.log`);
      const destination = path.join(this.directory, `helper.${index}.log`);
      try {
        if (index === MAX_LOG_FILES - 1) await unlink(destination).catch(() => undefined);
        await rename(source, destination);
      } catch {
        // Missing older log files are expected.
      }
    }

    const entries = await readdir(this.directory).catch(() => []);
    await Promise.all(entries
      .filter((entry) => /^helper\.\d+\.log$/.test(entry))
      .slice(MAX_LOG_FILES - 1)
      .map((entry) => unlink(path.join(this.directory, entry)).catch(() => undefined)));
  }
}
