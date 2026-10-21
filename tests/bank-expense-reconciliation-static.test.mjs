import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, markup, toolkit, styles] = await Promise.all([
  readFile(new URL('../supabase/migrations/20261021121542_bank_expense_reconciliation.sql', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.html', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8')
]);

test('bank reconciliation is additive, workspace scoped and owner controlled', () => {
  assert.match(migration, /add column if not exists payment_reference text/i);
  assert.match(migration, /external_transaction_id/i);
  assert.match(migration, /member\.workspace_id = p_workspace_id[\s\S]*member\.user_id = auth\.uid\(\)[\s\S]*member\.role = 'owner'/i);
  assert.match(migration, /revoke all on function public\.save_bank_expense[\s\S]*from public, anon/i);
  assert.doesNotMatch(migration, /delete from public\.(expenses|expense_categories)/i);
  assert.doesNotMatch(migration, /update public\.expenses[\s\S]*where[\s\S]*external_transaction_id is null/i);
});

test('helpful expense categories are seeded without rewriting legacy values', () => {
  for (const category of ['Communications', 'Transport', 'Professional services', 'Subscriptions', 'Shipping & customs', 'Marketplace fees', 'Packaging & fulfilment', 'Banking & payment fees', 'Taxes & compliance', 'Refunds & returns']) {
    assert.match(migration, new RegExp(category.replace(/[&]/g, '\\&'), 'i'));
  }
  assert.match(migration, /where not exists/i);
});

test('bank and expense pages share reconciliation controls and visual summaries', () => {
  assert.match(markup, /id="expense-bank-transaction"/);
  assert.match(markup, /name="paymentReference"/);
  assert.match(markup, /id="bank-category-chart"/);
  assert.match(markup, /id="expense-performance-bars"/);
  assert.match(toolkit, /save_bank_expense/);
  assert.match(toolkit, /data-bank-expense/);
  assert.match(toolkit, /businessPerformance/);
  assert.match(styles, /\.finance-overview-grid/);
  assert.match(styles, /\.bank-link-button/);
});
