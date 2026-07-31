import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { saveProjectAttachment } from '../src/main/attachmentWriter.ts';

test('helper saves supported Gmail attachments, skips exact duplicates, and safely renames conflicts', async () => {
  const projectFolder = await mkdtemp(path.join(os.tmpdir(), 'hexforge-gmail-files-'));
  try {
    const firstBytes = Buffer.from('solid model');
    const first = await saveProjectAttachment({
      projectFolderPath: projectFolder,
      projectFolderName: 'P42 Test u12345678 - TBC',
      filename: 'part.STL',
      expectedSize: firstBytes.byteLength,
      stream: Readable.from(firstBytes)
    });
    assert.equal(first.status, 'saved');
    assert.equal((await readFile(path.join(projectFolder, 'part.STL'))).toString(), 'solid model');

    const duplicate = await saveProjectAttachment({
      projectFolderPath: projectFolder,
      projectFolderName: 'P42 Test u12345678 - TBC',
      filename: 'part.STL',
      expectedSize: firstBytes.byteLength,
      stream: Readable.from(firstBytes)
    });
    assert.equal(duplicate.status, 'skipped');

    const differentBytes = Buffer.from('different model bytes');
    const conflict = await saveProjectAttachment({
      projectFolderPath: projectFolder,
      projectFolderName: 'P42 Test u12345678 - TBC',
      filename: 'part.STL',
      expectedSize: differentBytes.byteLength,
      stream: Readable.from(differentBytes)
    });
    assert.equal(conflict.status, 'renamed');
    assert.equal(conflict.filename, 'part (2).STL');
    assert.equal((await readFile(path.join(projectFolder, 'part.STL'))).toString(), 'solid model');
    assert.equal((await readFile(path.join(projectFolder, 'part (2).STL'))).toString(), 'different model bytes');

    await assert.rejects(() => saveProjectAttachment({
      projectFolderPath: projectFolder,
      projectFolderName: 'P42 Test u12345678 - TBC',
      filename: 'notes.pdf',
      expectedSize: 3,
      stream: Readable.from(Buffer.from('pdf'))
    }), /UNSUPPORTED_ATTACHMENT/);
  } finally {
    await rm(projectFolder, { recursive: true, force: true });
  }
});
