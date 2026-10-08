import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

// Bundle the real API code with its application aliases and fixture configuration.
export async function bundleApi(label) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'hexforge-regression-'));
  const outfile = join(directory, `${label}.mjs`);
  await build({
    entryPoints: [resolve(root, 'tests/performance/entry.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    tsconfig: resolve(root, 'tsconfig.app.json'),
    define: { 'import.meta.env': JSON.stringify({
      VITE_SUPABASE_URL: 'https://fixture.invalid',
      VITE_SUPABASE_ANON_KEY: 'fixture-public-key'
    }) },
    logLevel: 'silent'
  });
  return outfile;
}
