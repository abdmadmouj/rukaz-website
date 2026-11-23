// Single-file preview (for sharing as one HTML page): everything inlined, no server.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const r = await build({
  entryPoints: ['src/main.tsx'], bundle: true, format: 'iife', minify: true, write: false, outdir: 'out',
  jsx: 'automatic', target: ['es2022'], external: ['/fonts/*', '/images/*'],
  define: { 'process.env.NODE_ENV': '"production"', __PREVIEW__: 'true' },
});
let js = r.outputFiles.find((f) => f.path.endsWith('.js')).text;
let css = r.outputFiles.find((f) => f.path.endsWith('.css')).text;
const data = (path, type) => `data:${type};base64,${readFileSync(`public${path}`).toString('base64')}`;
css = css.replace(/url\(["']?(\/fonts\/[^"')]+)["']?\)/g, (_, p) => `url(${data(p, 'font/woff')})`);
js = js.replaceAll('/images/hero-render.jpg', data('/images/hero-render.jpg', 'image/jpeg'));
const icon = data('/favicon.svg', 'image/svg+xml');
const html = `<!doctype html><html lang="en" dir="ltr" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>RUKAZ. Value, brought to the surface.</title><meta name="description" content="RUKAZ is a venture builder. We build new businesses with groups and founders across the Middle East, from Amman."><meta name="theme-color" content="#F3F6F3"><link rel="icon" href="${icon}"><style>${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
mkdirSync('preview', { recursive: true });
writeFileSync('preview/RUKAZ.html', html);
console.log(`preview/RUKAZ.html ${(html.length / 1024 / 1024).toFixed(2)} MB`);
