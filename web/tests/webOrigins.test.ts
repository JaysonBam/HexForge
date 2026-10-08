import assert from 'node:assert/strict';
import test from 'node:test';
import { configuredWebOrigins } from '../../supabase/functions/_shared/webOrigins.ts';

test('local testing preserves the production origins and primary OAuth return origin', () => {
  assert.deepEqual(configuredWebOrigins('https://staff.example.com, https://preview.example.com/', 'http://127.0.0.1:5173'), [
    'https://staff.example.com', 'https://preview.example.com', 'http://127.0.0.1:5173'
  ]);
  assert.deepEqual(configuredWebOrigins('https://staff.example.com'), ['https://staff.example.com']);
});

test('development origins accept only exact loopback URLs with valid ports', () => {
  assert.deepEqual(configuredWebOrigins('https://staff.example.com', 'http://localhost:5173/,http://127.0.0.1:5173,http://127.0.0.1:5173,http://evil.example:5173,http://localhost.evil.example:5173,http://localhost:70000,http://localhost:0,http://localhost:5173/path,https://localhost:5173,*'), [
    'https://staff.example.com', 'http://localhost:5173', 'http://127.0.0.1:5173'
  ]);
});
