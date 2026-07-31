import { createWriteStream, type ReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { AttachmentSaveResult } from '../../../shared/localHelperProtocol.js';
import { isPathWithinRoot, sanitizeWindowsComponent } from './folders.js';

const MAX_GMAIL_ATTACHMENT_BYTES = 100 * 1024 * 1024;

const safeFilename = (filename: string): string => {
  const sanitized = sanitizeWindowsComponent(path.basename(filename), 'attachment');
  if (!/\.(stl|3mf|zip)$/i.test(sanitized)) throw new Error('UNSUPPORTED_ATTACHMENT');
  return sanitized;
};

const nextAvailableFilename = async (folderPath: string, filename: string): Promise<string> => {
  const extension = path.extname(filename);
  const base = path.basename(filename, extension);
  for (let index = 2; index <= 999; index += 1) {
    const candidate = `${base} (${index})${extension}`;
    const exists = await stat(path.join(folderPath, candidate)).then(() => true).catch(() => false);
    if (!exists) return candidate;
  }
  throw new Error('ATTACHMENT_NAME_EXHAUSTED');
};

export const saveProjectAttachment = async (args: {
  projectFolderPath: string;
  projectFolderName: string;
  filename: string;
  expectedSize: number;
  stream: Readable | ReadStream;
}): Promise<AttachmentSaveResult> => {
  if (!Number.isInteger(args.expectedSize) || args.expectedSize < 0 || args.expectedSize > MAX_GMAIL_ATTACHMENT_BYTES) {
    throw new Error('INVALID_ATTACHMENT_SIZE');
  }
  const canonicalFolder = await realpath(args.projectFolderPath);
  const originalFilename = safeFilename(args.filename);
  let destinationFilename = originalFilename;
  let status: AttachmentSaveResult['status'] = 'saved';
  const existing = await stat(path.join(canonicalFolder, originalFilename)).catch(() => null);
  if (existing?.isFile() && existing.size === args.expectedSize) {
    args.stream.resume();
    return { status: 'skipped', filename: originalFilename, size: existing.size, folderName: args.projectFolderName };
  }
  if (existing) {
    destinationFilename = await nextAvailableFilename(canonicalFolder, originalFilename);
    status = 'renamed';
  }
  const destinationPath = path.join(canonicalFolder, destinationFilename);
  const temporaryPath = path.join(canonicalFolder, `.${randomUUID()}.gmail-part`);
  if (!isPathWithinRoot(canonicalFolder, destinationPath) || path.dirname(destinationPath) !== canonicalFolder) {
    throw new Error('ATTACHMENT_OUTSIDE_PROJECT');
  }
  try {
    await pipeline(args.stream, createWriteStream(temporaryPath, { flags: 'wx' }));
    const written = await stat(temporaryPath);
    if (written.size !== args.expectedSize) throw new Error('ATTACHMENT_SIZE_MISMATCH');
    await rename(temporaryPath, destinationPath);
    return { status, filename: destinationFilename, size: written.size, folderName: args.projectFolderName };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
};
