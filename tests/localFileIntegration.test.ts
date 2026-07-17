import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from '../src/types/index.ts';
import { runSequentialImports } from '../src/local-files/importSequence.ts';
import { isImportEligibleFilename } from '../src/local-files/projectFileImport.ts';
import { findLinkedLocalFile, isFileLinkedToParts, normalizeSourceFilePath, sourceFileName } from '../src/local-files/sourceFileLink.ts';
import type { LocalProjectFile } from '../shared/localHelperProtocol.ts';
import { getExpectedWorkflowFolder, projectExpectsTbc } from '../src/local-files/projectFolderWorkflow.ts';

test('only existing parser formats are import eligible', () => {
  assert.equal(isImportEligibleFilename('model.3mf'), true);
  assert.equal(isImportEligibleFilename('print.gcode.3mf'), true);
  assert.equal(isImportEligibleFilename('print.ufp'), true);
  assert.equal(isImportEligibleFilename('model.stl'), false);
  assert.equal(isImportEligibleFilename('print.gcode'), false);
});

test('Import all processes files sequentially', async () => {
  const order: string[] = [];
  let active = 0;
  const completed = await runSequentialImports(['first', 'second', 'third'], async (name) => {
    active += 1;
    assert.equal(active, 1);
    order.push(name);
    await Promise.resolve();
    active -= 1;
    return name !== 'second';
  });
  assert.deepEqual(order, ['first', 'second', 'third']);
  assert.equal(completed, 2);
});

test('repeated imports are processed intentionally', async () => {
  const imported: string[] = [];
  const completed = await runSequentialImports(['plate.3mf', 'plate.3mf'], async (filename) => {
    imported.push(filename);
    return true;
  });
  assert.deepEqual(imported, ['plate.3mf', 'plate.3mf']);
  assert.equal(completed, 2);
});

test('source file links match stable project-relative paths', () => {
  const file = { relativePath: 'plates\\Widget.gcode.3mf' } as LocalProjectFile;
  const linkedPart = { sourceFilePath: 'plates/widget.gcode.3mf' } as Project['parts'][number];
  assert.equal(normalizeSourceFilePath(file.relativePath), 'plates/widget.gcode.3mf');
  assert.equal(isFileLinkedToParts(file, [linkedPart]), true);
  assert.equal(findLinkedLocalFile('plates/widget.gcode.3mf', [file]), file);
  assert.equal(sourceFileName(linkedPart.sourceFilePath as string), 'widget.gcode.3mf');
});

test('local workflow folder follows archive and print progress without changing project workflow', () => {
  const project = { id: 'ABCDE', priorityNumber: 1, studentName: 'A', studentNumber: '12345678', course: 'COS110', state: 'REVIEW', archived: false, parts: [] } as unknown as Project;
  assert.equal(getExpectedWorkflowFolder(project), 'to_be_printed');
  assert.equal(projectExpectsTbc(project), true);
  project.state = 'IN_PRODUCTION';
  project.parts = [{ printStatus: 'PRINTING' }] as Project['parts'];
  assert.equal(getExpectedWorkflowFolder(project), 'currently_printing');
  assert.equal(projectExpectsTbc(project), false);
  project.parts = [{ printStatus: 'PRINTED' }, { printStatus: 'POST_PROCESSING' }] as Project['parts'];
  assert.equal(getExpectedWorkflowFolder(project), 'completed_prints');
  project.archived = true;
  assert.equal(getExpectedWorkflowFolder(project), 'do_not_print');
});
