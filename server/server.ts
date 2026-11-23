import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { handleInterest, isConfigured, MAX_BODY_BYTES, type InterestConfig } from './interest';
import { MemoryRateStore, securityHeaders } from './security';

/**
 * The RUKAZ server: the built site plus two endpoints.
 *   POST /api/interest         an introduction (validated, rate limited, signed delivery)
 *   GET  /api/interest/status  whether online sending is set up (nothing else is revealed)
 *
 * Environment: PORT, PUBLIC_DIR, ALLOWED_ORIGINS (comma separated), RUKAZ_WEBHOOK_URL,
 * RUKAZ_WEBHOOK_SECRET, TRUST_PROXY=1 behind a proxy, NODE_ENV=production.
 */
const production = process.env.NODE_ENV === 'production';
const root = resolve(process.env.PUBLIC_DIR ?? join(process.cwd(), 'dist'));
const port = Number(process.env.PORT ?? 8080);
const headers = securityHeaders(production);
/** who may send forms: ALLOWED_ORIGINS, else the SITE_URL origin, else this machine (development) */
function allowedOrigins(): string[] {
  const listed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (listed.length) return listed;
  try {
    if (process.env.SITE_URL) {
      const u = new URL(process.env.SITE_URL);
      const www = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`;
      return [u.origin, `${u.protocol}//${www}`];
    }
  } catch { /* not a URL */ }
  if (production) console.warn('WARNING: set ALLOWED_ORIGINS (or SITE_URL) or every form sent from your domain will be refused.');
  return [`http://localhost:${port}`];
}

const config: InterestConfig = {
  webhookUrl: process.env.RUKAZ_WEBHOOK_URL,
  webhookSecret: process.env.RUKAZ_WEBHOOK_SECRET,
  allowedOrigins: allowedOrigins(),
  rate: new MemoryRateStore(),
  minFillSeconds: 3,
};

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.woff': 'font/woff', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text), ...extra });
  res.end(text);
}

function clientIp(req: IncomingMessage) {
  if (process.env.TRUST_PROXY === '1') {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

const TOO_LARGE = Symbol('too large');
/** read a JSON body up to MAX_BODY_BYTES; past that it stops reading and reports TOO_LARGE */
function readBody(req: IncomingMessage): Promise<string | null | typeof TOO_LARGE> {
  return new Promise((done) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) { done(TOO_LARGE); return; }
    let size = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { req.destroy(); done(null); }, 10_000);
    const onData = (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { clearTimeout(timer); req.off('data', onData); req.pause(); done(TOO_LARGE); return; }
      chunks.push(c);
    };
    req.on('data', onData);
    req.on('end', () => { clearTimeout(timer); done(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', () => { clearTimeout(timer); done(null); });
  });
}

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, headers).end();
    return;
  }
  if (rel.includes('\0')) { res.writeHead(400, headers).end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(root, rel));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(404, headers).end(); return; }
  let target = file;
  let st;
  let status = 200;
  try {
    st = statSync(target);
    if (st.isDirectory()) { target = join(target, 'index.html'); st = statSync(target); }
  } catch {
    // unknown paths get the site itself (single page); assets 404
    if (extname(rel)) { res.writeHead(404, { ...headers, 'content-type': 'text/plain' }).end('Not found'); return; }
    // a page that does not exist: visitors still get the site, search engines get a 404
    status = 404;
    target = join(root, 'index.html');
    try { st = statSync(target); } catch { res.writeHead(404, headers).end(); return; }
  }
  const type = TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream';
  const hashed = /\/assets\//.test(target);
  res.writeHead(status, {
    ...headers,
    'content-type': type,
    'content-length': st.size,
    'cache-control': type.startsWith('text/html') ? 'no-cache' : hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(target).pipe(res);
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/interest/status') {
    if (req.method !== 'GET') return send(res, 405, { ok: false }, { allow: 'GET' });
    return send(res, 200, { configured: isConfigured(config) });
  }
  if (url.pathname === '/api/interest') {
    if (req.method !== 'POST') return send(res, 405, { ok: false }, { allow: 'POST' });
    const raw = await readBody(req);
    // an oversized body gets a clear 413, then the connection is closed (the rest is never read)
    if (raw === TOO_LARGE) { res.on('finish', () => req.destroy()); return send(res, 413, { ok: false, code: 'too_large' }, { connection: 'close' }); }
    if (raw === null) return send(res, 408, { ok: false, code: 'timeout' }, { connection: 'close' });
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const r = await handleInterest(raw, { ip: clientIp(req), origin, contentType: req.headers['content-type'] }, config);
    return send(res, r.status, r.body);
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { ok: false });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...headers, allow: 'GET, HEAD' }).end(); return; }
  serveStatic(req, res, url.pathname);
});
server.headersTimeout = 15_000;
server.requestTimeout = 20_000;

if (process.env.RUKAZ_NO_LISTEN !== '1') {
  server.listen(port, () => console.log(`RUKAZ on http://localhost:${port} (${isConfigured(config) ? 'sending on' : 'sending not configured'})`));
}
