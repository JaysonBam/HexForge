import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { findBambuPlateFile, getBambuPlateIndex } from '@/lib/slicer-parsers/parsers/BambuParser.ts';

const metadata = (key: string, value: string) => ({
  getAttribute: (name: string) => name === 'key' ? key : name === 'value' ? value : null
});

test('uses the original Bambu plate index for a separately exported plate', () => {
  const entries = [
    metadata('prediction', '900'),
    metadata('index', '2'),
    metadata('thumbnail_file', 'Metadata/plate_2.png')
  ];

  assert.equal(getBambuPlateIndex(entries, 1), 2);

  const zip = new JSZip();
  zip.file('Metadata/plate_1.png', 'first plate');
  zip.file('Metadata/plate_2.png', 'second plate');

  const thumbnail = findBambuPlateFile(
    zip,
    entries,
    'thumbnail_file',
    'Metadata/plate_2.png',
    'Metadata/plate_1.png'
  );
  assert.equal(thumbnail?.name, 'Metadata/plate_2.png');
});

test('falls back to plate position when Bambu index metadata is missing or invalid', () => {
  assert.equal(getBambuPlateIndex([], 1), 1);
  assert.equal(getBambuPlateIndex([metadata('index', 'not-a-number')], 3), 3);
  assert.equal(getBambuPlateIndex([metadata('index', '0')], 2), 2);
});
