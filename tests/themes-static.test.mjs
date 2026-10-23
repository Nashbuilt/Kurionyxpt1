import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [theme, settings, styles, login, toolkit, worker] = await Promise.all([
  readFile(new URL('../theme.js', import.meta.url), 'utf8'),
  readFile(new URL('../settings.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../login.html', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.html', import.meta.url), 'utf8'),
  readFile(new URL('../sw.js', import.meta.url), 'utf8')
]);

test('appearance settings expose all three themes and persist per device', () => {
  assert.match(theme, /original:[\s\S]*tokyo:[\s\S]*amoled:/);
  assert.match(theme, /localStorage\.setItem\(STORAGE_KEY, nextTheme\)/);
  assert.match(settings, /\['appearance', 'Appearance'\]/);
  assert.match(settings, /data-theme-choice/);
});

test('Tokyo and AMOLED themes have dedicated responsive visual systems', () => {
  assert.match(styles, /data-theme="tokyo"/);
  assert.match(styles, /tokyo-skyscraper-night\.png/);
  assert.match(styles, /data-theme="amoled"/);
  assert.match(styles, /ui-monospace/);
  assert.match(styles, /@media\(max-width:800px\)[\s\S]*data-theme="tokyo"/);
});

test('new Kurionyx wordmark is used in the toolkit and black login experience', () => {
  assert.match(login, /kurionyx-wordmark-blue\.png/);
  assert.match(toolkit, /kurionyx-wordmark-blue\.png/);
  assert.match(styles, /\.login-page\{background:#000/);
  assert.match(styles, /grayscale\(1\) invert\(1\) contrast\(100\)/);
});

test('offline shell includes theme logic and visual assets', () => {
  assert.match(worker, /kurionyx-shell-v17/);
  assert.match(worker, /theme\.js/);
  assert.match(worker, /tokyo-skyscraper-night\.png/);
  assert.match(worker, /kurionyx-wordmark-blue\.png/);
});
