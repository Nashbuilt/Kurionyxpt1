import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, html, toolkit, styles] = await Promise.all([
  readFile(new URL('../supabase/migrations/20261020164207_stock_images_tracking_timeline.sql', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.html', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8')
]);

test('stock photos are private, workspace scoped and linked without deleting stock', () => {
  assert.match(migration, /values \('stock-images', 'stock-images', false/i);
  assert.match(migration, /foreign key \(workspace_id, stock_item_id\)/i);
  assert.match(migration, /references public\.stock_items\(workspace_id, id\) on delete restrict/i);
  assert.match(migration, /storage\.foldername\(name\)/i);
  assert.doesNotMatch(migration, /delete from public\.stock_items/i);
});

test('browser validates and uploads small supported stock images to unique paths', () => {
  assert.match(html, /name="images"[^>]+accept="image\/jpeg,image\/png,image\/webp"[^>]+multiple/);
  assert.match(toolkit, /5 \* 1024 \* 1024/);
  assert.match(toolkit, /crypto\.randomUUID\(\)/);
  assert.match(toolkit, /createSignedUrls/);
  assert.match(toolkit, /upsert: false/);
});

test('shipment tracking supports international handoff and append-only events', () => {
  assert.match(migration, /final_mile_tracking_number/i);
  assert.match(migration, /create table if not exists public\.shipment_tracking_events/i);
  assert.match(migration, /references public\.shipments\(workspace_id, id\) on delete restrict/i);
  assert.doesNotMatch(migration, /grant[^;]*delete on public\.shipment_tracking_events/i);
  assert.match(html, /name="finalMileCarrier"/);
  assert.match(html, /id="tracking-modal"/);
  assert.match(toolkit, /source: 'manual'/);
});

test('mobile stock and shipping views use app-like cards and touch targets', () => {
  assert.match(styles, /@media\(max-width:700px\)[\s\S]*\[data-panel="stock"\]/);
  assert.match(styles, /min-height:44px/);
  assert.match(styles, /safe-area-inset-bottom/);
  assert.match(styles, /max-height:92dvh/);
});
