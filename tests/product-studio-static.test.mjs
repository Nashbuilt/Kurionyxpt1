import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, html, script, styles] = await Promise.all([
  readFile(new URL('../supabase/migrations/20261021134000_product_studio_foundation.sql', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.html', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8')
]);

test('product research is workspace isolated and cannot be hard deleted by app users', () => {
  assert.match(migration, /create table if not exists public\.product_opportunities/i);
  assert.match(migration, /foreign key \(workspace_id, linked_stock_item_id\)/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /workspace_members[\s\S]*auth\.uid\(\)/i);
  assert.doesNotMatch(migration, /policy [\s\S]*for delete/i);
  assert.doesNotMatch(migration, /grant [^;]*delete/i);
  assert.doesNotMatch(migration, /grant select, insert, update on table/i);
  assert.match(migration, /grant update \([\s\S]*notes[\s\S]*\) on table public\.product_opportunities/i);
});

test('promotion reuses atomic stock creation and links exactly once', () => {
  assert.match(migration, /create or replace function public\.promote_product_opportunity/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /linked_stock_item_id is not null/i);
  assert.match(migration, /public\.create_stock_item\(/i);
  assert.match(migration, /research_status = 'converted'/i);
});

test('toolkit exposes grouped five-area navigation on desktop and mobile', () => {
  assert.equal((html.match(/class="nav-group/g) || []).length, 10); // wrapper + button for five areas
  assert.match(html, />Operations</);
  assert.match(html, />Money</);
  assert.match(html, />Products</);
  assert.match(html, />System</);
  assert.match(styles, /grid-template-columns:repeat\(5,1fr\)/);
  assert.match(styles, /\.nav-submenu[\s\S]*position:fixed/);
});

test('Product Studio remains separate until controlled stock promotion', () => {
  assert.match(html, /data-panel="products"/);
  assert.match(html, /Save product ideas and supplier research without adding them to live inventory/);
  assert.match(script, /product_opportunities/);
  assert.match(script, /promote_product_opportunity/);
  assert.match(html, /Only enter units already physically received/);
});
