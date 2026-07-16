import { execFile } from 'node:child_process';
import { lstat, opendir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { LocalFileGroup, LocalProjectFile, ProjectFilesResponse, SupportedFileKind } from '../../../shared/localHelperProtocol.js';
import type { HelperConfig } from './config.js';
import { isPathWithinRoot } from './folders.js';
import { OpaqueRegistry } from './registry.js';

const execFileAsync = promisify(execFile);
const MAX_RECURSION_DEPTH = 25;
const MAX_SUPPORTED_FILES = 10_000;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '__macosx', 'cache', 'caches', 'temp', 'tmp']);
const TEMPORARY_FILE = /(^~\$|\.tmp$|\.temp$|\.part$|\.bak$|\.swp$)/i;

export const classifySupportedFile = (filename: string): { kind: SupportedFileKind; group: LocalFileGroup; importEligible: boolean } | null => {
  const lower = filename.toLocaleLowerCase();
  if (lower.endsWith('.gcode.3mf')) return { kind: 'gcode.3mf', group: 'print_ready', importEligible: true };
  if (lower.endsWith('.gcode')) return { kind: 'gcode', group: 'print_ready', importEligible: false };
  if (lower.endsWith('.ufp')) return { kind: 'ufp', group: 'print_ready', importEligible: true };
  if (lower.endsWith('.stl')) return { kind: 'stl', group: 'model', importEligible: false };
  if (lower.endsWith('.3mf')) return { kind: '3mf', group: 'model', importEligible: false };
  if (lower.endsWith('.step')) return { kind: 'step', group: 'model', importEligible: false };
  if (lower.endsWith('.stp')) return { kind: 'stp', group: 'model', importEligible: false };
  if (lower.endsWith('.obj')) return { kind: 'obj', group: 'model', importEligible: false };
  return null;
};

const readHiddenSystemPaths = async (rootPath: string): Promise<Set<string>> => {
  if (process.platform !== 'win32') return new Set();
  try {
    const { stdout } = await execFileAsync('attrib.exe', ['/S', '/D', path.join(rootPath, '*')], {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    });
    const hidden = new Set<string>();
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.match(/^([A-Z ]{5,})\s+(.+)$/i);
      if (!match || (!match[1].includes('H') && !match[1].includes('S'))) continue;
      hidden.add(path.resolve(match[2]).toLocaleLowerCase());
    }
    return hidden;
  } catch {
    return new Set();
  }
};

export const scanProjectFiles = async (args: {
  rootPath: string;
  projectKey: string;
  projectFolder: { absolutePath: string; folderName: string; relativePath: string };
  config: HelperConfig;
  registry: OpaqueRegistry;
}): Promise<ProjectFilesResponse> => {
  const canonicalRoot = await realpath(args.rootPath);
  const canonicalProject = await realpath(args.projectFolder.absolutePath);
  if (!isPathWithinRoot(canonicalRoot, canonicalProject)) throw new Error('Project folder is outside the configured root.');
  const hiddenSystemPaths = await readHiddenSystemPaths(canonicalProject);
  const files: LocalProjectFile[] = [];
  let truncated = false;

  const visit = async (directoryPath: string, depth: number): Promise<void> => {
    if (depth > MAX_RECURSION_DEPTH || files.length >= MAX_SUPPORTED_FILES) {
      truncated = true;
      return;
    }
    const directory = await opendir(directoryPath).catch(() => null);
    if (!directory) return;
    for await (const entry of directory) {
      if (files.length >= MAX_SUPPORTED_FILES) {
        truncated = true;
        break;
      }
      if (entry.name.startsWith('.') || TEMPORARY_FILE.test(entry.name)) continue;
      const entryPath = path.join(directoryPath, entry.name);
      if (hiddenSystemPaths.has(path.resolve(entryPath).toLocaleLowerCase())) continue;
      const entryStats = await lstat(entryPath).catch(() => null);
      if (!entryStats || entryStats.isSymbolicLink()) continue;
      if (entryStats.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name.toLocaleLowerCase())) await visit(entryPath, depth + 1);
        continue;
      }
      if (!entryStats.isFile()) continue;
      const classification = classifySupportedFile(entry.name);
      if (!classification) continue;
      const canonicalFile = await realpath(entryPath).catch(() => null);
      if (!canonicalFile || !isPathWithinRoot(canonicalProject, canonicalFile)) continue;
      const currentStats = await stat(canonicalFile);
      const relativePath = path.relative(canonicalProject, canonicalFile);
      const fileId = args.registry.registerFile(args.config.identifierSecret, {
        absolutePath: canonicalFile,
        projectKey: args.projectKey,
        relativePath,
        size: currentStats.size,
        modifiedMs: currentStats.mtimeMs
      });
      files.push({
        fileId,
        filename: path.basename(canonicalFile),
        relativePath,
        relativeDirectory: path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath),
        size: currentStats.size,
        modifiedAt: currentStats.mtime.toISOString(),
        ...classification
      });
    }
  };

  await visit(canonicalProject, 0);
  files.sort((left, right) => left.group.localeCompare(right.group) || left.relativePath.localeCompare(right.relativePath));
  return {
    folderName: args.projectFolder.folderName,
    relativePath: args.projectFolder.relativePath,
    totalFiles: files.length,
    counts: {
      model: files.filter((file) => file.group === 'model').length,
      print_ready: files.filter((file) => file.group === 'print_ready').length
    },
    truncated,
    files
  };
};
