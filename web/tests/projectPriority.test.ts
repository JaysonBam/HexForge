import assert from 'node:assert/strict';
import test from 'node:test';
import { getNextProjectPriority } from '@/domain/projectPriority.ts';

const project = (priorityNumber: number, year: number) => ({
  priorityNumber,
  createdAt: `${year}-06-15T10:00:00.000Z`
});

test('next priority follows the highest priority in the requested year', () => {
  assert.equal(getNextProjectPriority([
    project(4, 2026),
    project(9, 2026),
    project(42, 2025)
  ], 2026), 10);
});

test('next priority starts at one when the requested year has no projects', () => {
  assert.equal(getNextProjectPriority([
    project(42, 2025)
  ], 2026), 1);
});

test('removing the highest priority makes that number available again', () => {
  assert.equal(getNextProjectPriority([
    project(4, 2026),
    project(8, 2026)
  ], 2026), 9);
});
