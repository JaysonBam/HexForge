import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupFilamentsByPrice,
  normalizeFilamentSettings,
} from '../src/domain/settingsConfig.ts';

test('filament settings keep configured materials only', () => {
  const filaments = normalizeFilamentSettings([
    { id: 'pla-row', type: 'pla', pricePerGram: 2.5 },
    { id: 'asa-row', type: 'ASA', pricePerGram: 4.25 }
  ]);

  assert.deepEqual(filaments.map((filament) => filament.type), ['ASA', 'pla']);
});

test('filament settings deduplicate materials case-insensitively', () => {
  const filaments = normalizeFilamentSettings([
    { id: 'pla-row', type: 'PLA', pricePerGram: 2.5 },
    { id: 'pla-updated-row', type: 'pla', pricePerGram: 3 }
  ]);

  assert.equal(filaments.length, 1);
  assert.equal(filaments[0].pricePerGram, 3);
});

test('filaments group by shared price', () => {
  const groups = groupFilamentsByPrice([
    { id: 'a', type: 'Filament A', pricePerGram: 2 },
    { id: 'b', type: 'Filament B', pricePerGram: 4 },
    { id: 'c', type: 'Filament C', pricePerGram: 2 }
  ]);

  assert.deepEqual(groups.map((group) => group.pricePerGram), [2, 4]);
  assert.deepEqual(groups[0].filaments.map((filament) => filament.type), ['Filament A', 'Filament C']);
});
