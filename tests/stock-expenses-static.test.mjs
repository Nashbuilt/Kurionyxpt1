import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, html, toolkit] = await Promise.all([
  readFile(new URL('../supabase/migrations/20261019111600_stock_linked_expenses_monzo_foundation.sql', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.html', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.js', import.meta.url), 'utf8')
]);

test('stock expense links are workspace-safe and preserve stock history', () => {
  assert.match(migration, /foreign key \(workspace_id, stock_item_id\)/i);
  assert.match(migration, /references public\.stock_items \(workspace_id, id\)/i);
  assert.match(migration, /on delete restrict/i);
  assert.doesNotMatch(migration, /delete from public\.(expenses|stock_items)/i);
});

test('landed-cost inclusion must be explicit and linked to stock', () => {
  assert.match(migration, /include_in_landed_cost boolean not null default false/i);
  assert.match(migration, /not include_in_landed_cost or stock_item_id is not null/i);
  assert.match(html, /name="includeInLandedCost"/);
  assert.match(toolkit, /include_in_landed_cost: includeInLandedCost/);
});

test('future Monzo imports are idempotent but no credentials are exposed', () => {
  assert.match(migration, /expenses_external_transaction_unique_idx/i);
  assert.match(migration, /'monzo_developer_api'/i);
  assert.match(migration, /revoke insert, update on table public\.expenses from authenticated/i);
  assert.doesNotMatch(migration, /grant insert \([^)]*(source_provider|external_transaction_id)/i);
  assert.doesNotMatch(`${html}\n${toolkit}\n${migration}`, /MONZO_CLIENT_SECRET\s*=/i);
});

