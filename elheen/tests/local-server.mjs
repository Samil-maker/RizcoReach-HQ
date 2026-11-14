// Runs the built site and the API on one port with an in-memory store, for local testing.
// Usage: node build.mjs && node tests/local-server.mjs   (invite code: letmein)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHandler } from '../netlify/functions/api.mjs';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const m = new Map();
const store = {
  async get(key, o) { const v = m.get(key); return v ? (o?.type === 'json' ? JSON.parse(v.data) : v.data) : null; },
  async setJSON(key, value) { m.set(key, { data: JSON.stringify(value) }); },
  async set(key, data, o) { m.set(key, { data, metadata: o?.metadata }); },
  async getWithMetadata(key) { const v = m.get(key); return v ? { data: v.data, metadata: v.metadata } : null; },
  async list({ prefix }) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
};
const api = makeHandler(store, { ELHEEN_INVITE: 'letmein' });
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await api(new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let path = url.pathname === '/' ? '/index.html' : url.pathname;
  if (path.startsWith('/b/')) path = '/b.html';
  if (path === '/app') path = '/app.html';
  try { const data = await readFile(join(dist, path)); res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(process.env.PORT || 8770, () => console.log('http://localhost:' + (process.env.PORT || 8770)));
