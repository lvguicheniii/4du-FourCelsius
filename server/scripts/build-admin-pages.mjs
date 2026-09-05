import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverDirectory = path.resolve(scriptsDirectory, '..');
const sourceDirectory = path.join(serverDirectory, 'src', 'public', 'admin');
const outputDirectory = path.join(serverDirectory, 'admin-pages-dist');

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });
const adminHtml = fs.readFileSync(path.join(sourceDirectory, 'index.html'), 'utf8')
  .replaceAll('/admin/logo.png', '/admin-assets/logo.png')
  .replaceAll('/admin/favicon.png', '/admin-assets/favicon.png');
fs.writeFileSync(path.join(outputDirectory, 'admin-content'), adminHtml);
const adminAssetsDirectory = path.join(outputDirectory, 'admin-assets');
fs.mkdirSync(adminAssetsDirectory, { recursive: true });
for (const name of ['logo.png', 'favicon.png']) {
  fs.copyFileSync(path.join(sourceDirectory, name), path.join(adminAssetsDirectory, name));
}

fs.writeFileSync(path.join(outputDirectory, '_redirects'), '');
fs.writeFileSync(path.join(outputDirectory, '_worker.js'), `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') return Response.redirect(new URL('/admin', url), 302);
    if (url.pathname === '/admin/') return Response.redirect(new URL('/admin', url), 301);
    if (url.pathname === '/admin') {
      const assetUrl = new URL('/admin-content', url);
      const asset = await env.ASSETS.fetch(new Request(assetUrl, request));
      const headers = new Headers(asset.headers);
      headers.set('Content-Type', 'text/html; charset=UTF-8');
      return new Response(asset.body, { status: 200, headers });
    }
    return env.ASSETS.fetch(request);
  }
};
`);
fs.writeFileSync(path.join(outputDirectory, '_headers'), `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000
  Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://your-api.example https://*.myqcloud.com; media-src 'self' blob: https://your-api.example https://*.myqcloud.com; connect-src 'self' https://your-api.example
`);

console.log(outputDirectory);
