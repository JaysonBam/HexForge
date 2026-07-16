import { createHmac, randomUUID } from 'node:crypto';
import type { FolderMatch } from './folders.js';

export type RegisteredProject = Pick<FolderMatch, 'absolutePath' | 'folderName' | 'relativePath'>;
export type RegisteredFile = {
  absolutePath: string;
  projectKey: string;
  relativePath: string;
  size: number;
  modifiedMs: number;
};

export class OpaqueRegistry {
  private readonly projects = new Map<string, RegisteredProject>();
  private readonly candidates = new Map<string, RegisteredProject>();
  private readonly files = new Map<string, RegisteredFile>();

  registerProject(project: RegisteredProject): string {
    const existing = Array.from(this.projects.entries()).find(([, value]) => value.absolutePath === project.absolutePath);
    if (existing) return existing[0];
    const key = randomUUID();
    this.projects.set(key, project);
    return key;
  }

  updateProject(key: string, project: RegisteredProject): void {
    if (!this.projects.has(key)) throw new Error('Unknown project key.');
    this.projects.set(key, project);
  }

  getProject(key: string): RegisteredProject | null {
    return isUuid(key) ? this.projects.get(key) ?? null : null;
  }

  registerCandidate(project: RegisteredProject): string {
    const key = randomUUID();
    this.candidates.set(key, project);
    return key;
  }

  consumeCandidate(key: string): RegisteredProject | null {
    if (!isUuid(key)) return null;
    const candidate = this.candidates.get(key) ?? null;
    if (candidate) this.candidates.delete(key);
    return candidate;
  }

  registerFile(secret: string, file: RegisteredFile): string {
    const signature = `${file.relativePath.toLocaleLowerCase()}\0${file.size}\0${file.modifiedMs}`;
    const fileId = createHmac('sha256', secret).update(signature).digest('hex');
    this.files.set(fileId, file);
    return fileId;
  }

  getFile(fileId: string): RegisteredFile | null {
    return isOpaqueFileId(fileId) ? this.files.get(fileId) ?? null : null;
  }
}

export const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const isOpaqueFileId = (value: string): boolean => /^[0-9a-f]{64}$/i.test(value);
