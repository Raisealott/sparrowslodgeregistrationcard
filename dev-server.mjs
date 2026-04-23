import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const PORT = Number(process.env.PORT || 5500);
const ROOT = process.cwd();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const requested = urlPath === '/' ? '/index.html' : urlPath;
    const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(ROOT, safePath);
    const body = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

function listen(port) {
  server.listen(port, () => {
    console.log(`Dev server running at http://localhost:${port}`);
  });
}

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    listen((err.port || PORT) + 1);
    return;
  }
  throw err;
});

listen(PORT);
