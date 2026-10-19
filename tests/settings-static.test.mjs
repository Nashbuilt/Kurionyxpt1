import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/202610170002_settings_foundation.sql', import.meta.url), 'utf8');
const settings = await readFile(new URL('../settings.js', import.meta.url), 'utf8');
const toolkit = await readFile(new URL('../toolkit.html', import.meta.url), 'utf8');

const expectedTables = [
  'workspace_profiles', 'suppliers', 'sales_channels', 'stock_locations',
  'product_categories', 'expense_categories', 'workspace_integrations'
];

test('migration creates every required workspace-scoped settings table', () => {
  for (const table of expectedTables) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`${table}[\\s\\S]*?workspace_id bigint`, 'i'));
  }
});

test('settings tables use RLS and explicit grants without delete permission', () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /member\.role = ''owner''/i);
  assert.match(migration, /grant select, insert, update on table public\.suppliers to authenticated/i);
  assert.doesNotMatch(migration, /grant[^;]*delete[^;]*settings|grant[^;]*delete[^;]*suppliers/i);
});

test('active names are unique per workspace and archived names remain reusable', () => {
  for (const table of ['suppliers', 'sales_channels', 'stock_locations', 'product_categories', 'expense_categories']) {
    assert.match(migration, new RegExp(`${table}_workspace_active_name_idx[\\s\\S]*?where archived_at is null`, 'i'));
  }
});

test('legacy operational records are not rewritten', () => {
  assert.doesNotMatch(migration, /update\s+public\.(stock_items|stock_sales|expenses)/i);
  assert.match(settings, /Select or retain a legacy category/);
  assert.match(settings, /Select or enter a legacy channel/);
});

test('settings interface includes all requested sections', () => {
  for (const label of ['Business Profile', 'Suppliers', 'Sales Channels', 'Stock Locations', 'Product Categories', 'Expense Categories', 'Team & Permissions', 'Integrations']) {
    assert.match(settings, new RegExp(label.replace('&', '\\&')));
  }
  assert.match(toolkit, /data-view="settings"/);
  assert.match(toolkit, /data-panel="settings"/);
});

test('team administration remains honest while integrations use server-side controls', () => {
  assert.match(settings, /Invitations, account creation and role changes are not available/i);
  assert.match(settings, /Credentials and bank tokens remain server-side/i);
  assert.doesNotMatch(settings, /service_role|secret_key|api_key/i);
});

test('archiving is used instead of destructive deletion', () => {
  assert.match(settings, /archived_at/);
  assert.doesNotMatch(settings, /\.delete\(/);
  assert.match(settings, /Historical references will be preserved/);
});
