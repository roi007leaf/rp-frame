import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const target = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!target.startsWith(root) || !mime[path.extname(target)]) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', mime[path.extname(target)]);
    response.setHeader('Cache-Control', 'no-store');
    response.end(await readFile(target));
  } catch { response.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/tests/fixtures/browser.html`));
