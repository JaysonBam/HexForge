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
  isPathWithinRoot,
  replaceProjectStatusSuffix,
  sanitizeWindowsComponent
} from '../helper/src/main/folders.ts';
import { classifySupportedFile } from '../helper/src/main/fileScanner.ts';
import { isOpaqueFileId, OpaqueRegistry } from '../helper/src/main/registry.ts';

const project = {
  projectId: 'ABCDE',
  priorityNumber: 107,
  studentName: 'Jane Smith',
  studentNumber: '12345678',
  module: 'COS110'
};

test('project folder names use the confirmed Windows convention', () => {
  assert.equal(generateProjectFolderName(project), 'P107 - Jane Smith - u12345678 - COS110 - tbc');
});

test('Windows filename sanitisation removes invalid characters and reserved names', () => {
  assert.equal(sanitizeWindowsComponent(' Jane: Smith. '), 'Jane Smith');
  assert.equal(sanitizeWindowsComponent('CON', 'Unknown'), 'Unknown');
  assert.equal(sanitizeWindowsComponent(`A${String.fromCharCode(1)}B`), 'A B');
});

test('project folder matching is priority exact and ambiguity-safe', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hexforge-folders-'));
  await Promise.all([
    mkdir(path.join(root, 'P107 - Jane Smith - u12345678 - COS110 - tbc')),
    mkdir(path.join(root, 'P107 - Other Student - u87654321 - COS110 - tbc')),
    mkdir(path.join(root, 'P1070 - Wrong Priority - u12345678 - COS110 - tbc'))
  ]);
  const matches = await findProjectFolderMatches(root, project);
  assert.equal(matches.length, 2);
  assert.equal(chooseClearFolderMatch(matches)?.folderName, 'P107 - Jane Smith - u12345678 - COS110 - tbc');

  const ambiguous = await findProjectFolderMatches(root, { ...project, studentName: 'Unknown', studentNumber: '00000000', module: 'X' });
  assert.equal(chooseClearFolderMatch(ambiguous), null);
});

test('project folder creation is idempotent and prevents duplicates', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hexforge-create-'));
  const first = await createProjectFolder(root, project);
  const second = await createProjectFolder(root, project);
  assert.equal(first.absolutePath, second.absolutePath);
  assert.deepEqual(await readdir(root), ['P107 - Jane Smith - u12345678 - COS110 - tbc']);
});

test('only recognized folder status suffixes are replaced', () => {
  assert.equal(replaceProjectStatusSuffix('P107 - Jane - u12345678 - COS110 - tbc', 'collected'), 'P107 - Jane - u12345678 - COS110 - collected');
  assert.equal(replaceProjectStatusSuffix('P107 - Jane - u12345678 - COS110 - done', 'collected'), null);
});

test('path traversal and encoded traversal resolve outside the root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hexforge-root-'));
  const escaped = path.resolve(root, decodeURIComponent('..%2Foutside.txt'));
  assert.equal(isPathWithinRoot(root, escaped), false);
  assert.equal(isPathWithinRoot(root, path.join(root, 'project', 'part.3mf')), true);
});

test('opaque file identifiers are validated and registered', () => {
  const registry = new OpaqueRegistry();
  const projectKey = registry.registerProject({ absolutePath: 'C:\\Projects\\P1', folderName: 'P1', relativePath: 'P1' });
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
