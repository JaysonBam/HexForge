import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LOCAL_HELPER_DEFAULT_PORT, WORKFLOW_FOLDER_KEYS, type SupportedFileKind, type WorkflowFolderKey } from '../../../shared/localHelperProtocol.js';

export type ApplicationMapping = 'bambu' | 'cura' | 'system';

export type HelperConfig = {
  schemaVersion: 2;
  workflowFolders: Record<WorkflowFolderKey, string | null>;
  port: number;
  allowedOrigins: string[];
  bambuStudioPath: string | null;
  curaPath: string | null;
  startWithWindows: boolean;
  defaultApplications: Record<SupportedFileKind, ApplicationMapping>;
  installationId: string;
  identifierSecret: string;
  lastCopyDestination: string | null;
};

const DEFAULT_APPLICATIONS: Record<SupportedFileKind, ApplicationMapping> = {
  stl: 'system',
  '3mf': 'bambu',
  step: 'system',
  stp: 'system',
  obj: 'system',
  gcode: 'system',
  'gcode.3mf': 'bambu',
  ufp: 'cura'
};

const defaultConfig = (): HelperConfig => ({
  schemaVersion: 2,
  workflowFolders: {
    to_be_printed: null,
    currently_printing: null,
    completed_prints: null,
    do_not_print: null
  },
  port: LOCAL_HELPER_DEFAULT_PORT,
  allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  bambuStudioPath: null,
  curaPath: null,
  startWithWindows: false,
  defaultApplications: { ...DEFAULT_APPLICATIONS },
  installationId: randomUUID(),
  identifierSecret: randomBytes(32).toString('hex'),
  lastCopyDestination: null
});

export const normalizeAllowedOrigin = (input: string): string | null => {
  try {
    const url = new URL(input.trim());
    const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) return null;
    return url.origin;
  } catch {
    return null;
  }
};

const normalizeConfig = (value: unknown): HelperConfig => {
  const defaults = defaultConfig();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const input = value as Partial<HelperConfig>;
  const allowedOrigins = Array.isArray(input.allowedOrigins)
    ? Array.from(new Set(input.allowedOrigins.map(normalizeAllowedOrigin).filter((origin): origin is string => Boolean(origin))))
    : defaults.allowedOrigins;

  return {
    ...defaults,
    schemaVersion: 2,
    workflowFolders: Object.fromEntries(
      WORKFLOW_FOLDER_KEYS.map((key) => {
        const configured = input.workflowFolders?.[key];
        return [key, typeof configured === 'string' && configured.trim() ? path.resolve(configured) : null];
      })
    ) as Record<WorkflowFolderKey, string | null>,
    port: Number.isInteger(input.port) && Number(input.port) >= 1024 && Number(input.port) <= 65535
      ? Number(input.port)
      : defaults.port,
    allowedOrigins: allowedOrigins.length ? allowedOrigins : defaults.allowedOrigins,
    bambuStudioPath: typeof input.bambuStudioPath === 'string' && input.bambuStudioPath.trim() ? input.bambuStudioPath : null,
    curaPath: typeof input.curaPath === 'string' && input.curaPath.trim() ? input.curaPath : null,
    startWithWindows: Boolean(input.startWithWindows),
    defaultApplications: {
      ...defaults.defaultApplications,
      ...(input.defaultApplications ?? {})
    },
    installationId: typeof input.installationId === 'string' && input.installationId ? input.installationId : defaults.installationId,
    identifierSecret: typeof input.identifierSecret === 'string' && input.identifierSecret.length >= 32
      ? input.identifierSecret
      : defaults.identifierSecret,
    lastCopyDestination: typeof input.lastCopyDestination === 'string' && input.lastCopyDestination
      ? input.lastCopyDestination
      : null
  };
};

export class ConfigStore {
  readonly directory: string;
  readonly filePath: string;
  private config: HelperConfig = defaultConfig();

  constructor(appDataDirectory: string) {
    this.directory = path.join(appDataDirectory, 'HexForgeFileHelper');
    this.filePath = path.join(this.directory, 'config.json');
  }

  async load(): Promise<HelperConfig> {
    await mkdir(this.directory, { recursive: true });
    try {
      this.config = normalizeConfig(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
      this.config = defaultConfig();
      await this.save(this.config);
    }
    return this.get();
  }

  get(): HelperConfig {
    return structuredClone(this.config);
  }

  async save(next: HelperConfig): Promise<HelperConfig> {
    this.config = normalizeConfig(next);
    await mkdir(this.directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, this.filePath);
    return this.get();
  }

  async update(updates: Partial<HelperConfig>): Promise<HelperConfig> {
    return this.save({ ...this.config, ...updates });
  }
}
