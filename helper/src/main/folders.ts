import { cp, mkdir, readdir, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { WORKFLOW_FOLDER_KEYS, WORKFLOW_FOLDER_LABELS, type FolderSyncState, type ProjectDescriptor, type WorkflowFolderKey } from '../../../shared/localHelperProtocol.js';

const INVALID_WINDOWS_CHARS = /[<>:"/\\|?*]/g;
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export type WorkflowFolderPaths = Record<WorkflowFolderKey, string>;

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

export const normalizeStudentNumber = (studentNumber: string): string => `u${studentNumber.replace(/\D/g, '').slice(0, 8)}`;

export const generateProjectFolderName = (project: ProjectDescriptor, includeTbc = project.expectTbc ?? true): string => {
  const base = [
    `P${Math.max(1, Math.trunc(project.priorityNumber))}`,
    sanitizeWindowsComponent(project.studentName, 'Unknown Student'),
    sanitizeWindowsComponent(normalizeStudentNumber(project.studentNumber), 'u00000000')
  ].join(' ');
  return includeTbc ? `${base} - TBC` : base;
};

export const isPathWithinRoot = (rootPath: string, candidatePath: string): boolean => {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const normalizeForMatch = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export type FolderMatch = {
  absolutePath: string;
  folderName: string;
  relativePath: string;
  workflowFolder: WorkflowFolderKey;
  score: number;
  studentNumberMatch: boolean;
};

export const scoreFolderCandidate = (folderName: string, project: ProjectDescriptor): Pick<FolderMatch, 'score' | 'studentNumberMatch'> => {
  const candidate = normalizeForMatch(folderName);
  const studentNumber = normalizeForMatch(normalizeStudentNumber(project.studentNumber));
  const studentNumberMatch = candidate.includes(studentNumber) || candidate.includes(normalizeForMatch(project.studentNumber));
  let score = studentNumberMatch ? 4 : 0;
  if (candidate.includes(normalizeForMatch(project.studentName))) score += 2;
  return { score, studentNumberMatch };
};

export const findProjectFolderMatches = async (workflowFolders: WorkflowFolderPaths, project: ProjectDescriptor): Promise<FolderMatch[]> => {
  const priorityPattern = new RegExp(`^P${Math.trunc(project.priorityNumber)}(?!\\d)`, 'i');
  const matches: FolderMatch[] = [];
  const seen = new Set<string>();
  for (const workflowFolder of WORKFLOW_FOLDER_KEYS) {
    const canonicalRoot = await realpath(workflowFolders[workflowFolder]);
    const entries = await readdir(canonicalRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !priorityPattern.test(entry.name)) continue;
      const absolutePath = await realpath(path.join(canonicalRoot, entry.name));
      const identity = absolutePath.toLocaleLowerCase();
      if (!isPathWithinRoot(canonicalRoot, absolutePath) || seen.has(identity)) continue;
      seen.add(identity);
      matches.push({
        absolutePath,
        folderName: entry.name,
        relativePath: entry.name,
        workflowFolder,
        ...scoreFolderCandidate(entry.name, project)
      });
    }
  }
  return matches.sort((left, right) => right.score - left.score || left.folderName.localeCompare(right.folderName));
};

export const chooseClearFolderMatch = (matches: FolderMatch[]): FolderMatch | null => {
  if (matches.length === 1) return matches[0];
  if (!matches.length) return null;
  const [best, runnerUp] = matches;
  return best.studentNumberMatch && best.score > runnerUp.score ? best : null;
};

export const getFolderSyncState = (match: FolderMatch, project: ProjectDescriptor): FolderSyncState => {
  const expectedWorkflowFolder = project.expectedWorkflowFolder ?? 'to_be_printed';
  const expectedFolderName = generateProjectFolderName(project);
  const locationMismatch = match.workflowFolder !== expectedWorkflowFolder;
  const nameMismatch = match.folderName !== expectedFolderName;
  const actionParts: string[] = [];
  if (locationMismatch) actionParts.push(`Move to ${WORKFLOW_FOLDER_LABELS[expectedWorkflowFolder]}`);
  if (nameMismatch) {
    if (!project.expectTbc && /\s+-\s+TBC$/i.test(match.folderName)) actionParts.push('Remove TBC');
    else if (project.expectTbc && !/\s+-\s+TBC$/i.test(match.folderName)) actionParts.push('Add TBC');
    else actionParts.push('Update folder name');
  }
  return {
    isInSync: !locationMismatch && !nameMismatch,
    expectedWorkflowFolder,
    expectedFolderName,
    locationMismatch,
    nameMismatch,
    suggestedActionLabel: actionParts.join(' and ') || 'Folder is in sync'
  };
};

export const createProjectFolder = async (workflowFolders: WorkflowFolderPaths, project: ProjectDescriptor): Promise<FolderMatch> => {
  const workflowFolder: WorkflowFolderKey = 'to_be_printed';
  const canonicalRoot = await realpath(workflowFolders[workflowFolder]);
  const folderName = generateProjectFolderName({ ...project, expectTbc: true }, true);
  const desiredPath = path.join(canonicalRoot, folderName);
  if (!isPathWithinRoot(canonicalRoot, desiredPath) || path.dirname(desiredPath) !== canonicalRoot) throw new Error('Generated project folder is outside To Be Printed.');
  await mkdir(desiredPath, { recursive: false }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const absolutePath = await realpath(desiredPath);
  return { absolutePath, folderName, relativePath: folderName, workflowFolder, score: 6, studentNumberMatch: true };
};

export const syncProjectFolder = async (workflowFolders: WorkflowFolderPaths, match: FolderMatch, project: ProjectDescriptor): Promise<FolderMatch> => {
  const expectedWorkflowFolder = project.expectedWorkflowFolder ?? 'to_be_printed';
  const sourceRoot = await realpath(workflowFolders[match.workflowFolder]);
  const destinationRoot = await realpath(workflowFolders[expectedWorkflowFolder]);
  const sourcePath = await realpath(match.absolutePath);
  if (!isPathWithinRoot(sourceRoot, sourcePath) || path.dirname(sourcePath) !== sourceRoot) throw new Error('Project folder is outside its configured workflow folder.');
  const folderName = generateProjectFolderName(project);
  const destinationPath = path.join(destinationRoot, folderName);
  if (!isPathWithinRoot(destinationRoot, destinationPath) || path.dirname(destinationPath) !== destinationRoot) throw new Error('Destination is outside the configured workflow folder.');
  const resolvedSource = path.resolve(sourcePath);
  const resolvedDestination = path.resolve(destinationPath);
  if (resolvedSource !== resolvedDestination) {
    if (resolvedSource.toLocaleLowerCase() === resolvedDestination.toLocaleLowerCase()) {
      const temporaryPath = `${sourcePath}.${process.pid}.rename`;
      await rename(sourcePath, temporaryPath);
      await rename(temporaryPath, destinationPath);
    } else {
      try {
        await rename(sourcePath, destinationPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
        await cp(sourcePath, destinationPath, { recursive: true, errorOnExist: true, force: false });
        await rm(sourcePath, { recursive: true });
      }
    }
  }
  const absolutePath = await realpath(destinationPath);
  return { absolutePath, folderName, relativePath: folderName, workflowFolder: expectedWorkflowFolder, score: 6, studentNumberMatch: true };
};
