import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  chooseClearFolderMatch,
  createProjectFolder,
  findProjectFolderMatches,
  generateProjectFolderName,
  getFolderSyncState,
  isPathWithinRoot,
  sanitizeWindowsComponent,
  syncProjectFolder,
  type WorkflowFolderPaths
} from '../helper/src/main/folders.ts';
import { classifySupportedFile } from '../helper/src/main/fileScanner.ts';
import { isOpaqueFileId, OpaqueRegistry } from '../helper/src/main/registry.ts';

const project = {
  projectId: 'ABCDE',
  priorityNumber: 107,
  studentName: 'Jane Smith',
  studentNumber: '12345678'
};

const makeWorkflowFolders = async (): Promise<WorkflowFolderPaths> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hexforge-workflow-'));
  const folders: WorkflowFolderPaths = {
    to_be_printed: path.join(root, 'To Be Printed'),
    currently_printing: path.join(root, 'Currently Printing'),
    completed_prints: path.join(root, 'Completed Prints'),
    do_not_print: path.join(root, 'Do Not Print')
  };
  await Promise.all(Object.values(folders).map((folder) => mkdir(folder)));
  return folders;
};

test('project folder names use the confirmed Windows convention', () => {
  assert.equal(generateProjectFolderName(project), 'P107 Jane Smith u12345678 - TBC');
  assert.equal(generateProjectFolderName({ ...project, expectTbc: false }), 'P107 Jane Smith u12345678');
});

test('Windows filename sanitisation removes invalid characters and reserved names', () => {
  assert.equal(sanitizeWindowsComponent(' Jane: Smith. '), 'Jane Smith');
  assert.equal(sanitizeWindowsComponent('CON', 'Unknown'), 'Unknown');
  assert.equal(sanitizeWindowsComponent(`A${String.fromCharCode(1)}B`), 'A B');
});

test('project folder matching is priority exact and ambiguity-safe', async () => {
  const folders = await makeWorkflowFolders();
  await Promise.all([
    mkdir(path.join(folders.currently_printing, 'P107 Jane Smith u12345678')),
    mkdir(path.join(folders.to_be_printed, 'P107 Other Student u87654321 - TBC')),
    mkdir(path.join(folders.completed_prints, 'P107legacy naming is still this project')),
    mkdir(path.join(folders.do_not_print, 'P1070 Wrong Priority u12345678'))
  ]);
  const matches = await findProjectFolderMatches(folders, project);
  assert.equal(matches.length, 3);
  assert.equal(matches.some((match) => match.folderName === 'P107legacy naming is still this project'), true);
  assert.equal(matches.some((match) => match.folderName.startsWith('P1070')), false);
  assert.equal(chooseClearFolderMatch(matches)?.folderName, 'P107 Jane Smith u12345678');

  const ambiguous = await findProjectFolderMatches(folders, { ...project, studentName: 'Unknown', studentNumber: '00000000' });
  assert.equal(chooseClearFolderMatch(ambiguous), null);
});

test('project folder creation is idempotent and prevents duplicates', async () => {
  const folders = await makeWorkflowFolders();
  const first = await createProjectFolder(folders, project);
  const second = await createProjectFolder(folders, project);
  assert.equal(first.absolutePath, second.absolutePath);
  assert.deepEqual(await readdir(folders.to_be_printed), ['P107 Jane Smith u12345678 - TBC']);
});

test('folder synchronization reports and repairs workflow location and TBC naming', async () => {
  const folders = await makeWorkflowFolders();
  const created = await createProjectFolder(folders, project);
  const expected = { ...project, expectedWorkflowFolder: 'currently_printing' as const, expectTbc: false };
  const before = getFolderSyncState(created, expected);
  assert.equal(before.locationMismatch, true);
  assert.equal(before.nameMismatch, true);
  const synced = await syncProjectFolder(folders, created, expected);
  assert.equal(synced.workflowFolder, 'currently_printing');
  assert.equal(synced.folderName, 'P107 Jane Smith u12345678');
  assert.equal(getFolderSyncState(synced, expected).isInSync, true);
  assert.deepEqual(await readdir(folders.to_be_printed), []);
});

test('path traversal and encoded traversal resolve outside the root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hexforge-root-'));
  const escaped = path.resolve(root, decodeURIComponent('..%2Foutside.txt'));
  assert.equal(isPathWithinRoot(root, escaped), false);
  assert.equal(isPathWithinRoot(root, path.join(root, 'project', 'part.3mf')), true);
});

test('opaque file identifiers are validated and registered', () => {
  const registry = new OpaqueRegistry();
  const projectKey = registry.registerProject({ absolutePath: 'C:\\Projects\\P1', folderName: 'P1', relativePath: 'P1', workflowFolder: 'to_be_printed' });
  const fileId = registry.registerFile('secret-secret-secret-secret-secret', {
    absolutePath: 'C:\\Projects\\P1\\plate.3mf',
    projectKey,
    relativePath: 'plate.3mf',
    size: 42,
    modifiedMs: 123
  });
  assert.equal(isOpaqueFileId(fileId), true);
  assert.equal(registry.getFile('../plate.3mf'), null);
  assert.equal(registry.getFile('f'.repeat(64))?.absolutePath, undefined);
});

test('supported extension detection handles compound extensions first', () => {
  assert.deepEqual(classifySupportedFile('plate.GCODE.3MF'), { kind: 'gcode.3mf', group: 'print_ready', importEligible: true });
  assert.deepEqual(classifySupportedFile('plate.3mf'), { kind: '3mf', group: 'model', importEligible: false });
  assert.deepEqual(classifySupportedFile('model.stl'), { kind: 'stl', group: 'model', importEligible: false });
  assert.deepEqual(classifySupportedFile('print.gcode'), { kind: 'gcode', group: 'print_ready', importEligible: false });
});

test('junction or symlink escapes are rejected by canonical containment', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hexforge-junction-root-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'hexforge-junction-outside-'));
  const link = path.join(root, 'linked');
  try {
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    context.skip('Creating a directory link is not permitted in this environment.');
    return;
  }
  const canonicalOutside = await import('node:fs/promises').then(({ realpath }) => realpath(link));
  assert.equal(isPathWithinRoot(root, canonicalOutside), false);
});
