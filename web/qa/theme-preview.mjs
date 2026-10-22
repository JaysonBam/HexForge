import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const web = resolve(import.meta.dirname, '..');
const root = resolve(web, 'dist');
await build({ entryPoints: [resolve(import.meta.dirname, 'theme-fixture.tsx')], outfile: resolve(root, 'theme-preview.js'), bundle: true, format: 'esm', platform: 'browser', loader: { '.svg': 'dataurl' }, tsconfig: resolve(web, 'tsconfig.app.json'), alias: { '@': resolve(web, 'src') }, define: { 'import.meta.env': JSON.stringify({ VITE_SUPABASE_URL: 'https://theme-fixture.invalid', VITE_SUPABASE_ANON_KEY: 'fixture-public-key' }), 'process.env.NODE_ENV': '"production"' }, minify: true });
const productionHtml = await readFile(resolve(root, 'index.html'), 'utf8');
const html = productionHtml.replace(/<script type="module"[^>]*src="[^"]*"[^>]*><\/script>/, '<script type="module" src="/theme-preview.js"></script>');
await writeFile(resolve(root, 'theme-preview.html'), html);
if (!process.argv.includes('--build-only')) createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  let path = resolve(root, '.' + decodeURIComponent(pathname));
  if (!path.startsWith(root + '/') && !path.startsWith(root + '\\') && path !== root) { res.writeHead(403).end(); return; }
  try { if (!(await stat(path)).isFile()) throw new Error(); } catch { path = resolve(root, 'theme-preview.html'); }
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
  try { res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(await readFile(path)); } catch { res.writeHead(404).end(); }
}).listen(5197, '127.0.0.1', () => console.log('Theme visual preview (sample data): http://127.0.0.1:5197'));
