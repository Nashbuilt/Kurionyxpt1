import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('orange, graphite and petrol teal define the application atmosphere', () => {
  assert.match(styles, /--bank-ink:#103f47/);
  assert.match(styles, /--bank-coral:#f47a24/);
  assert.match(styles, /kurionyx-wave-orange-teal-v3\.png/);
  assert.equal(manifest.theme_color, '#103f47');
  assert.equal(manifest.background_color, '#dfe4e6');
});

test('the generated background is bundled into the installable app shell', () => {
  assert.equal(existsSync(new URL('../assets/backgrounds/kurionyx-wave-orange-teal-v3.png', import.meta.url)), true);
  assert.match(serviceWorker, /kurionyx-wave-orange-teal-v3\.png/);
  assert.match(serviceWorker, /kurionyx-shell-v19/);
});
