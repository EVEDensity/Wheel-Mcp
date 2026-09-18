import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const docs = fileURLToPath(new URL('../docs/', import.meta.url));
const port = Number(process.env.PORT || 4173);
const prefix = '/Wheel-mcp/';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.pck': 'application/octet-stream',
  '.md': 'text/plain; charset=utf-8',
};
const server = http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405);
      response.end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/' || pathname === '/Wheel-mcp') {
      response.writeHead(302, { Location: prefix });
      response.end();
      return;
    }
    if (!pathname.startsWith(prefix)) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const relative = pathname.slice(prefix.length);
    if (relative.includes('\\') || relative.includes('\0') || relative.split('/').some((p) => p.startsWith('.'))) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }
    let target = path.resolve(docs, relative);
    const within = path.relative(docs, target);
    if (within.startsWith('..') || path.isAbsolute(within)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }
    if ((await stat(target)).isDirectory()) {
      if (!pathname.endsWith('/')) {
        response.writeHead(302, { Location: pathname + '/' });
        response.end();
        return;
      }
      target = path.join(target, 'index.html');
    }
    const body = await readFile(target);
    response.writeHead(200, {
      'Content-Type': mime[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    response.writeHead(error instanceof URIError ? 400 : 404);
    response.end('Not found');
  }
});
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Wheel-mcp static preview: http://127.0.0.1:${port}${prefix}`));
