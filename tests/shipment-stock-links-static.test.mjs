import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, toolkit] = await Promise.all([
  readFile(new URL('../supabase/migrations/20261021131526_shipment_stock_links.sql', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.js', import.meta.url), 'utf8')
]);

test('shipment stock links are workspace constrained and future multi-item capable', () => {
  assert.match(migration, /create table if not exists public\.shipment_items/i);
  assert.match(migration, /foreign key \(workspace_id, shipment_id\)/i);
  assert.match(migration, /foreign key \(workspace_id, stock_item_id\)/i);
  assert.match(migration, /unique \(shipment_id, stock_item_id\)/i);
  assert.match(migration, /enable row level security/i);
});

test('incoming shipment receipt is controlled and idempotent', () => {
  assert.match(migration, /create or replace function public\.receive_incoming_shipment/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /source_type = 'shipment_item'/i);
  assert.match(migration, /movement_type, quantity_delta[\s\S]*'receipt'/i);
  assert.match(migration, /if target\.status = 'delivered' then raise exception/i);
  assert.doesNotMatch(migration, /delete from public\.(stock_items|shipments|inventory_movements)/i);
});

test('stock and shipping interfaces expose both directions of the link', () => {
  assert.match(toolkit, /Create linked shipment/);
  assert.match(toolkit, /Linked incoming shipments/);
  assert.match(toolkit, /Receive into stock/);
  assert.match(toolkit, /receive_incoming_shipment/);
  assert.match(toolkit, /shipment_items/);
});

test('selected application view survives refresh through URL state', () => {
  assert.match(toolkit, /window\.location\.hash/);
  assert.match(toolkit, /window\.history\.replaceState/);
  assert.match(toolkit, /addEventListener\('hashchange'/);
});
