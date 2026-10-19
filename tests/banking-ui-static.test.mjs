import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [css, html] = await Promise.all([
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.html', import.meta.url), 'utf8')
]);

test('toolkit uses the Kurionyx banking interface tokens', () => {
  assert.match(css, /--bank-ink:#142033/i);
  assert.match(css, /--bank-coral:#ff5a67/i);
  assert.match(css, /metric-grid article:first-child/i);
  assert.match(css, /border-radius:22px/i);
});

test('mobile toolkit becomes a bottom-navigation app shell', () => {
  assert.match(css, /@media\(max-width:800px\)[\s\S]*aside\{position:fixed/i);
  assert.match(css, /bottom:0/);
  assert.match(css, /scroll-snap-type:x mandatory/i);
  assert.match(css, /padding-bottom:82px/i);
});

test('stock and dashboard retain semantic navigation', () => {
  assert.match(html, /data-view="dashboard"/);
  assert.match(html, /data-view="stock"/);
  assert.match(html, /aria-label="Toolkit navigation"/);
});
