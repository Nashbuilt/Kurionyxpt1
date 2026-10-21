import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, markup, toolkit, styles] = await Promise.all([
  readFile(new URL('../supabase/migrations/20261021123420_bank_income_classification.sql', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.html', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8')
]);

test('income records are additive, workspace scoped and owner only', () => {
  assert.match(migration, /create table if not exists public\.income_records/i);
  assert.match(migration, /member\.workspace_id = p_workspace_id[\s\S]*member\.user_id = auth\.uid\(\)[\s\S]*member\.role = 'owner'/i);
  assert.match(migration, /alter table public\.income_records enable row level security/i);
  assert.match(migration, /revoke all on table public\.income_records from public, anon, authenticated/i);
  assert.match(migration, /unique index[\s\S]*workspace_id, external_transaction_id/i);
  assert.doesNotMatch(migration, /delete from public\./i);
});

test('income classifications cover useful sources without declaring ownership', () => {
  for (const category of ['Sales revenue', 'Investment', 'Owner contribution', 'Loan received', 'Refund or rebate', 'Interest or rewards', 'Tax refund', 'Asset sale', 'Grant', 'Other']) assert.match(markup, new RegExp(category, 'i'));
  assert.match(markup, /does not establish legal ownership/i);
});

test('bank UI reconciles incoming payments and renders a separate chart', () => {
  assert.match(markup, /id="bank-income-chart"/);
  assert.match(markup, /id="income-table"/);
  assert.match(markup, /id="income-modal"/);
  assert.match(toolkit, /save_bank_income/);
  assert.match(toolkit, /data-bank-income/);
  assert.match(toolkit, /renderBankIncomeChart/);
  assert.match(styles, /\.bank-category-grid/);
});
