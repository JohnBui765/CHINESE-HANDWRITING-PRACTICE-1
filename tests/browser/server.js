// A tiny static web server for tests (dev only).
// It serves this project at http://localhost:<port>/CHINESE-HANDWRITING-PRACTICE-1/, the same path as on
// GitHub Pages, so the manifest id and the service worker scope behave as they will online.
// Run it by hand with:  node tests/browser/server.js   (then open http://localhost:8000/CHINESE-HANDWRITING-PRACTICE-1/)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = '/CHINESE-HANDWRITING-PRACTICE-1/';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.bcmap': 'application/octet-stream',
};

export function startServer(port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/CHINESE-HANDWRITING-PRACTICE-1') {
      res.writeHead(301, { Location: BASE });
      return res.end();
    }
    if (!url.pathname.startsWith(BASE)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    let rel = decodeURIComponent(url.pathname.slice(BASE.length));
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not found');
      }
      const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => {
      const address = `http://localhost:${server.address().port}${BASE}`;
      resolve({ server, address, close: () => new Promise(r => server.close(r)) });
    });
  });
}

// Started directly (not imported by a test): serve on port 8000.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { address } = await startServer(8000);
  console.log(`Serving ${ROOT} at ${address}  (Ctrl+C to stop)`);
}
