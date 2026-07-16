import { mkdir, readdir, realpath, rename } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectDescriptor } from '../../../shared/localHelperProtocol.js';

const INVALID_WINDOWS_CHARS = /[<>:"/\\|?*]/g;
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const STATUS_SUFFIX = /\s+-\s+(tbc|collected)$/i;

export const sanitizeWindowsComponent = (value: string, fallback = 'Unknown'): string => {
  let output = value
    .normalize('NFKC')
    .split('')
    .map((character) => character.charCodeAt(0) < 32 ? ' ' : character)
    .join('')
    .replace(INVALID_WINDOWS_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!output || RESERVED_WINDOWS_NAMES.test(output)) output = fallback;
  if (output.length > 80) output = output.slice(0, 80).replace(/[. ]+$/g, '');
  return output || fallback;
};

export const normalizeStudentNumber = (studentNumber: string): string => {
  const digits = studentNumber.replace(/\D/g, '').slice(0, 8);
  return `u${digits}`;
};

export const generateProjectFolderName = (project: ProjectDescriptor, status: 'tbc' | 'collected' = 'tbc'): string =>
  [
    `P${Math.max(1, Math.trunc(project.priorityNumber))}`,
    sanitizeWindowsComponent(project.studentName, 'Unknown Student'),
    sanitizeWindowsComponent(normalizeStudentNumber(project.studentNumber), 'u00000000'),
    sanitizeWindowsComponent(project.module, 'Unknown Module'),
    status
  ].join(' - ');

export const isPathWithinRoot = (rootPath: string, candidatePath: string): boolean => {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const normalizeForMatch = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export type FolderMatch = {
  absolutePath: string;
  folderName: string;
  relativePath: string;
  score: number;
  studentNumberMatch: boolean;
};

export const scoreFolderCandidate = (folderName: string, project: ProjectDescriptor): Pick<FolderMatch, 'score' | 'studentNumberMatch'> => {
  const candidate = normalizeForMatch(folderName);
  const studentNumber = normalizeForMatch(normalizeStudentNumber(project.studentNumber));
  const studentNumberWithoutPrefix = normalizeForMatch(project.studentNumber);
  const studentNumberMatch = candidate.includes(studentNumber) || candidate.includes(studentNumberWithoutPrefix);
  let score = studentNumberMatch ? 4 : 0;
  if (candidate.includes(normalizeForMatch(project.studentName))) score += 2;
  if (candidate.includes(normalizeForMatch(project.module))) score += 1;
  return { score, studentNumberMatch };
};

export const findProjectFolderMatches = async (rootPath: string, project: ProjectDescriptor): Promise<FolderMatch[]> => {
  const canonicalRoot = await realpath(rootPath);
  const priorityPattern = new RegExp(`^P${Math.trunc(project.priorityNumber)}(?:\\s+-\\s+|$)`, 'i');
  const entries = await readdir(canonicalRoot, { withFileTypes: true });
  const matches: FolderMatch[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !priorityPattern.test(entry.name)) continue;
    const absolutePath = await realpath(path.join(canonicalRoot, entry.name));
    if (!isPathWithinRoot(canonicalRoot, absolutePath)) continue;
    const scored = scoreFolderCandidate(entry.name, project);
    matches.push({
      absolutePath,
      folderName: entry.name,
      relativePath: path.relative(canonicalRoot, absolutePath) || '.',
      ...scored
    });
  }

  return matches.sort((left, right) => right.score - left.score || left.folderName.localeCompare(right.folderName));
};

export const chooseClearFolderMatch = (matches: FolderMatch[]): FolderMatch | null => {
  if (matches.length === 1) return matches[0];
  if (!matches.length) return null;
  const [best, runnerUp] = matches;
  return best.studentNumberMatch && best.score > runnerUp.score ? best : null;
};

export const createProjectFolder = async (rootPath: string, project: ProjectDescriptor): Promise<FolderMatch> => {
  const canonicalRoot = await realpath(rootPath);
  const folderName = generateProjectFolderName(project);
  const desiredPath = path.join(canonicalRoot, folderName);
  if (!isPathWithinRoot(canonicalRoot, desiredPath) || path.dirname(desiredPath) !== canonicalRoot) {
    throw new Error('Generated project folder is outside the configured root.');
  }
  await mkdir(desiredPath, { recursive: false }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const absolutePath = await realpath(desiredPath);
  if (!isPathWithinRoot(canonicalRoot, absolutePath)) throw new Error('Created folder escaped the configured root.');
  return {
    absolutePath,
    folderName: path.basename(absolutePath),
    relativePath: path.relative(canonicalRoot, absolutePath),
    score: 7,
    studentNumberMatch: true
  };
};

export const replaceProjectStatusSuffix = (folderName: string, status: 'collected'): string | null => {
  if (!STATUS_SUFFIX.test(folderName)) return null;
  return folderName.replace(STATUS_SUFFIX, ` - ${status}`);
};

export const renameProjectFolderStatus = async (
  rootPath: string,
  folderPath: string,
  status: 'collected'
): Promise<{ absolutePath: string; folderName: string; relativePath: string }> => {
  const canonicalRoot = await realpath(rootPath);
  const canonicalFolder = await realpath(folderPath);
  if (!isPathWithinRoot(canonicalRoot, canonicalFolder) || path.dirname(canonicalFolder) !== canonicalRoot) {
    throw new Error('Project folder is outside the configured root.');
  }
  const nextName = replaceProjectStatusSuffix(path.basename(canonicalFolder), status);
  if (!nextName) throw new Error('The project folder does not end in a recognized status suffix.');
  if (nextName === path.basename(canonicalFolder)) {
    return { absolutePath: canonicalFolder, folderName: nextName, relativePath: path.relative(canonicalRoot, canonicalFolder) };
  }
  const nextPath = path.join(canonicalRoot, nextName);
  if (!isPathWithinRoot(canonicalRoot, nextPath)) throw new Error('Renamed folder would escape the configured root.');
  await rename(canonicalFolder, nextPath);
  const absolutePath = await realpath(nextPath);
  return { absolutePath, folderName: nextName, relativePath: path.relative(canonicalRoot, absolutePath) };
};
