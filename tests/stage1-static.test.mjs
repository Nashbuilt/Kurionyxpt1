import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/202610170001_stage1_inventory_integrity.sql', import.meta.url);
const toolkitPath = new URL('../toolkit.js', import.meta.url);
const htmlPath = new URL('../toolkit.html', import.meta.url);

const [migration, toolkit, html] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(toolkitPath, 'utf8'),
  readFile(htmlPath, 'utf8')
]);

test('migration preserves existing balances as unverified snapshots', () => {
  assert.match(migration, /'opening_balance'/);
  assert.match(migration, /historical source not inferred/i);
  assert.match(migration, /'unverified'/);
  assert.doesNotMatch(migration, /update\s+public\.stock_items\s+set\s+units\s*=\s*0/i);
});

test('sales post one linked movement instead of a second direct decrement', () => {
  const saleFunction = migration.match(/create or replace function private\.apply_stock_sale\(\)[\s\S]*?\$\$;/i)?.[0] || '';
  assert.match(saleFunction, /insert into public\.inventory_movements/i);
  assert.match(saleFunction, /'stock_sale'/i);
  assert.doesNotMatch(saleFunction, /update\s+public\.stock_items/i);
  assert.match(migration, /unique index[\s\S]*inventory_movements_source_unique_idx/i);
});

test('browser clients cannot directly change quantities or delete stock', () => {
  assert.match(migration, /revoke insert, delete on table public\.stock_items from authenticated/i);
  assert.match(migration, /revoke update on table public\.stock_items from authenticated/i);
  assert.doesNotMatch(migration, /grant update \([^)]*units/i);
  assert.match(migration, /drop policy if exists "Members can remove stock"/i);
});

test('business record deletion is replaced by reasoned archiving', () => {
  assert.match(migration, /revoke delete on table public\.expenses from authenticated/i);
  assert.match(migration, /revoke delete on table public\.shipments from authenticated/i);
  assert.match(migration, /function public\.archive_business_record/i);
  assert.doesNotMatch(toolkit, /\.delete\(/);
});

test('manual changes require a reason and exclude sale movements', () => {
  assert.match(migration, /p_movement_type not in \('receipt', 'return', 'adjustment'\)/i);
  assert.match(migration, /A reason is required/i);
  assert.match(html, /id="movement-form"/);
  assert.match(toolkit, /record_inventory_movement/);
});

test('confirmed dashboard metrics filter for verified records', () => {
  assert.match(toolkit, /confirmedStock = records\.stock\.filter\(item => item\.dataStatus === 'verified'/);
  assert.match(toolkit, /confirmedSales = records\.sales\.filter\(item => item\.dataStatus === 'verified'/);
  assert.match(toolkit, /confirmedShipments = records\.shipments\.filter\(item => item\.dataStatus === 'verified'/);
});

test('all record classifications are exposed in forms', () => {
  for (const status of ['verified', 'unverified', 'demonstration']) {
    assert.match(html, new RegExp(`value="${status}"`));
    assert.match(migration, new RegExp(`'${status}'`));
  }
});
