import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Exercise the actual pre-paint script: a provider-only test misses theme flashes.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)![1];
function firstPaint(saved: string | null, darkSystem: boolean, storageBlocked = false) {
  const root = { dataset: {} as Record<string, string>, style: { colorScheme: '' } };
  const meta = { content: '' };
  vm.runInNewContext(bootstrap, {
    document: { documentElement: root, querySelector: () => meta },
    localStorage: { getItem: () => { if (storageBlocked) throw new Error('Storage denied'); return saved; } },
    matchMedia: () => ({ matches: darkSystem })
  });
  return { theme: root.dataset.theme, scheme: root.style.colorScheme, browserChrome: meta.content };
}

test('a saved light preference prevents a dark-system first-paint flash', () => {
  assert.deepEqual(firstPaint('light', true), { theme: 'light', scheme: 'light', browserChrome: '#eef3f8' });
});
test('a saved dark preference is applied before React on a light system', () => {
  assert.deepEqual(firstPaint('dark', false), { theme: 'dark', scheme: 'dark', browserChrome: '#0f172a' });
});
test('a new browser follows both system colour schemes', () => {
  assert.equal(firstPaint(null, true).theme, 'dark');
  assert.equal(firstPaint(null, false).theme, 'light');
});
test('invalid stored preferences fall back to the system', () => {
  assert.equal(firstPaint('invalid', true).theme, 'dark');
  assert.equal(firstPaint('invalid', false).theme, 'light');
});
test('blocked local storage still produces a usable themed first paint', () => {
  assert.equal(firstPaint(null, true, true).theme, 'dark');
  assert.equal(firstPaint(null, false, true).scheme, 'light');
});
