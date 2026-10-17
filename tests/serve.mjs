// Minimal static server for local development and tests: serves public/ the way
// Firebase Hosting does, including the reserved /__/firebase/init.json.
// Usage: node tests/serve.mjs [port]   (pair with the Firebase emulators for sign-in)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const port = Number(process.argv[2] || process.env.PORT || 5055);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const initJson = JSON.stringify({ projectId: 'demo-acce', apiKey: 'demo-key', authDomain: 'localhost', appId: 'demo' });

http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/__/firebase/init.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(initJson); }
  let file = path.join(root, url === '/' ? 'index.html' : url);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, '404.html');
  res.writeHead(file.endsWith('404.html') && url !== '/404.html' ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`ACCE Archive on http://127.0.0.1:${port}`));
