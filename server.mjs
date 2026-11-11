// Gap Stack server: serves the page and data, and proxies two Claude calls.
// No dependencies. Node 18+.  Run: node server.mjs   (then open http://localhost:5173)
// Route logic lives in lib/core.mjs, shared with the Vercel functions in api/.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 5173);

// Minimal .env loader (keys stay out of git; see .env.example)
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const { health, rates, memo, program, MODEL } = await import('./lib/core.mjs');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.csv': 'text/csv; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(JSON.stringify(obj));
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, health());
    if (req.method === 'GET' && url.pathname === '/api/rates') return send(res, 200, await rates(ROOT));
    if (req.method === 'POST' && url.pathname === '/api/memo') return send(res, 200, await memo(await readBody(req)));
    if (req.method === 'POST' && url.pathname === '/api/program') return send(res, 200, await program(await readBody(req)));
    // static: /data/* from data/, everything else from public/
    let path = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const base = path.startsWith('/data/') ? ROOT : join(ROOT, 'public');
    const file = normalize(join(base, path));
    if (!file.startsWith(normalize(ROOT))) return send(res, 403, { error: 'forbidden' });
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(file));
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
}).listen(PORT, () => {
  console.log(`Gap Stack running at http://localhost:${PORT}  (Claude: ${process.env.ANTHROPIC_API_KEY ? MODEL() : 'no key, template memo'})`);
});
