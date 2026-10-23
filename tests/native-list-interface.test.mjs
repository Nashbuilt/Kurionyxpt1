import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const toolkit = readFileSync(new URL('../toolkit.js', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../settings.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('dense record actions are consolidated into accessible menus', () => {
  assert.match(toolkit, /function actionMenu\(actions\)/);
  assert.match(toolkit, /summary aria-label="More actions"/);
  assert.match(settings, /class="action-menu"/);
  assert.match(styles, /\.action-sheet/);
});

test('application surfaces use responsive frosted glass with a reduced-transparency fallback', () => {
  assert.match(styles, /backdrop-filter:blur\(22px\)/);
  assert.match(styles, /@media\(prefers-reduced-transparency:reduce\)/);
  assert.match(styles, /bottom:calc\(80px \+ env\(safe-area-inset-bottom\)\)/);
});

test('the PWA shell cache is refreshed for the redesigned assets', () => {
  assert.match(serviceWorker, /kurionyx-shell-v21/);
  assert.match(styles, /\[data-panel="stock"\]>\.section-tool-head \+ \.table-wrap table/);
  assert.match(serviceWorker, /'\/styles\.css'/);
  assert.match(serviceWorker, /'\/toolkit\.js'/);
  assert.match(styles, /\.action-menu:not\(\[open\]\) \.action-sheet\{display:none\}/);
  assert.match(styles, /\.toolkit-page\{overflow-x:hidden/);
});
