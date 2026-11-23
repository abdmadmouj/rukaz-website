// Build: bundle the site with esbuild into dist/, write index.html with hashed asset names,
// copy public/, and bundle the server into dist-server/.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const prod = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
// STATIC=1 builds for plain file hosting (GitHub Pages): no Node server, so the forms are
// emailed through a form service and the security policy travels in the page itself
const isStatic = process.env.STATIC === '1';
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/assets', { recursive: true });
cpSync('public', 'dist', { recursive: true });

const result = await build({
  entryPoints: { app: 'src/main.tsx' },
  bundle: true,
  format: 'esm',
  splitting: false,
  outdir: 'dist/assets',
  entryNames: '[name]-[hash]',
  minify: prod,
  sourcemap: prod ? false : 'linked',
  target: ['es2022', 'chrome110', 'safari16', 'firefox115'],
  jsx: 'automatic',
  external: ['/fonts/*', '/images/*'],
  define: { 'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development'), __STATIC__: String(isStatic) },
  legalComments: 'linked',
  metafile: true,
  logLevel: 'info',
});

const outs = Object.keys(result.metafile.outputs);
const js = outs.find((o) => o.endsWith('.js'));
const css = outs.find((o) => o.endsWith('.css'));

// Pre-render both languages: the full page as HTML, readable before any script runs
await build({
  entryPoints: ['src/prerender.tsx'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist-server/prerender.mjs',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"production"', __STATIC__: String(isStatic) },
  // CommonJS inside an ES module needs a real require
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'error',
});
const { render } = await import(`${process.cwd()}/dist-server/prerender.mjs?v=${Date.now()}`);

// SITE_URL (e.g. https://rukaz.com) makes canonical and share links absolute; set it for production
const site = (process.env.SITE_URL ?? '').replace(/\/$/, '');
const abs = (path) => (site ? `${site}${path}` : path);
const esc = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// the same rules the Node server sends as a header, plus the two form services
const STATIC_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self' https://formsubmit.co https://api.web3forms.com",
  "media-src 'self' blob:", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
  // no upgrade-insecure-requests here: while GitHub is still issuing the HTTPS certificate the
  // site is served over plain http, and upgrading its own files to https would break the page.
  // GitHub's "Enforce HTTPS" moves everyone to https once the certificate is ready.
].join('; ');

function page(lang) {
  const { html: body, meta } = render(lang);
  const path = lang === 'ar' ? '/ar/' : '/';
  return `<!doctype html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" data-prerendered="${lang}" data-theme="light" style="color-scheme: light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">
<meta name="theme-color" content="#F3F6F3">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="strict-origin-when-cross-origin">
${isStatic ? `<meta http-equiv="Content-Security-Policy" content="${STATIC_CSP}">` : ''}
${site ? `<link rel="canonical" href="${abs(path)}">` : ''}
<link rel="alternate" hreflang="en" href="${abs('/')}">
<link rel="alternate" hreflang="ar" href="${abs('/ar/')}">
<link rel="alternate" hreflang="x-default" href="${abs('/')}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="RUKAZ">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:locale" content="${lang === 'ar' ? 'ar_JO' : 'en_US'}">
<meta property="og:locale:alternate" content="${lang === 'ar' ? 'en_US' : 'ar_JO'}">
${site ? `<meta property="og:url" content="${abs(path)}">` : ''}
<meta property="og:image" content="${abs('/images/share.jpg')}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(meta.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(meta.title)}">
<meta name="twitter:description" content="${esc(meta.description)}">
<meta name="twitter:image" content="${abs('/images/share.jpg')}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/InterTight-var.woff" as="font" type="font/woff" crossorigin>
<link rel="stylesheet" href="/assets/${basename(css)}">
<script type="module" src="/assets/${basename(js)}"></script>
</head>
<body>
<div id="root">${body}</div>
</body>
</html>
`;
}
writeFileSync('dist/index.html', page('en'));
mkdirSync('dist/ar', { recursive: true });
writeFileSync('dist/ar/index.html', page('ar'));
writeFileSync('dist/robots.txt', `User-agent: *\nAllow: /\n${site ? `Sitemap: ${site}/sitemap.xml\n` : ''}`);
if (isStatic) {
  // GitHub Pages: the custom domain, no Jekyll processing, and the site itself for unknown pages
  if (site) writeFileSync('dist/CNAME', `${new URL(site).hostname}\n`);
  writeFileSync('dist/.nojekyll', '');
  writeFileSync('dist/404.html', page('en'));
}
if (site) writeFileSync('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${site}/</loc></url><url><loc>${site}/ar/</loc></url></urlset>\n`);

await build({
  entryPoints: ['server/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist-server/server.mjs',
  logLevel: 'info',
});
console.log(`built ${prod ? 'production' : 'development'}${isStatic ? ' (static, for GitHub Pages)' : ''}: ${basename(js)} ${basename(css)}, pre-rendered / and /ar/${site ? ` for ${site}` : ' (set SITE_URL for absolute share links)'}`);
