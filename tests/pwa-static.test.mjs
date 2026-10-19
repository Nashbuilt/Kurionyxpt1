import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));
const toolkit = readFileSync('toolkit.html', 'utf8');
const serviceWorker = readFileSync('sw.js', 'utf8');
const css = readFileSync('styles.css', 'utf8');

test('Kurionyx exposes an installable standalone app manifest', () => {
  assert.equal(manifest.start_url, '/toolkit.html');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
  assert.match(toolkit, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(toolkit, /apple-touch-icon/);
});

test('the application shell registers and caches local assets', () => {
  assert.match(toolkit, /src="pwa\.js"/);
  assert.match(serviceWorker, /CACHE_NAME/);
  assert.match(serviceWorker, /'\/toolkit\.html'/);
  assert.match(serviceWorker, /event\.request\.method !== 'GET'/);
});

test('mobile KPI cards are centred and snap to the centre', () => {
  assert.match(css, /metric-grid-six article\{[^}]*scroll-snap-align:center[^}]*text-align:center[^}]*align-items:center/i);
  assert.match(css, /metric-grid-six\{[^}]*scroll-padding-inline:/i);
});
