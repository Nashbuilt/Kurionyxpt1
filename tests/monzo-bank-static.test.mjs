import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, edgeFunction, toolkit, markup, styles, serviceWorker] = await Promise.all([
  readFile(new URL('../supabase/migrations/20261020193746_monzo_bank_read_api.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/monzo-bank-summary/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.js', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../sw.js', import.meta.url), 'utf8')
]);

test('bank credentials remain service-role-only and encrypted in Vault', () => {
  assert.match(migration, /vault\.decrypted_secrets/i);
  assert.match(migration, /revoke all on function public\.get_monzo_connection_for_sync\(bigint\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.get_monzo_connection_for_sync\(bigint\) to service_role/i);
  assert.doesNotMatch(toolkit, /MONZO_CLIENT_SECRET|access_token|refresh_token/i);
});

test('bank summary is owner-only and returns business balances, pots and transactions', () => {
  assert.match(edgeFunction, /membership\.role !== 'owner'/);
  assert.match(edgeFunction, /\/balance\?account_id=/);
  assert.match(edgeFunction, /\/pots\?current_account_id=/);
  assert.match(edgeFunction, /\/transactions\?account_id=/);
  assert.match(edgeFunction, /payments:/);
  assert.match(edgeFunction, /income:/);
  assert.match(edgeFunction, /Cache-Control': 'no-store'/);
  assert.match(edgeFunction, /balanceResponse\.status === 401/);
  assert.match(edgeFunction, /warnings:/);
  assert.match(edgeFunction, /89 \* 24 \* 60 \* 60 \* 1000/);
  assert.doesNotMatch(edgeFunction, /expand\[\]=merchant/);
  assert.match(edgeFunction, /internalTransfer: \/\^pot_/);
  assert.match(edgeFunction, /status: matchingRefund \? 'refunded'/);
  assert.match(edgeFunction, /transaction\.settled \? 'completed' : 'pending'/);
  assert.match(edgeFunction, /isRefund:/);
  assert.match(toolkit, /transaction\.status === 'completed' && !transaction\.refunded/);
});

test('expired Monzo tokens refresh and rotate without reaching the browser', () => {
  assert.match(edgeFunction, /grant_type: 'refresh_token'/);
  assert.match(edgeFunction, /rotate_monzo_connection_tokens/);
  assert.match(edgeFunction, /reauthorisation_required/);
  assert.match(migration, /vault\.update_secret/i);
});

test('toolkit provides a responsive Bank page and explicit owner restriction', () => {
  assert.match(markup, /data-view="bank"/);
  assert.match(markup, /data-panel="bank"/);
  assert.match(markup, /id="bank-pots"/);
  assert.match(markup, /id="bank-payments"/);
  assert.match(markup, /id="bank-income"/);
  assert.match(toolkit, /functions\.invoke\('monzo-bank-summary'/);
  assert.match(toolkit, /workspaceRole !== 'owner'/);
  assert.match(styles, /\.bank-activity-grid/);
  assert.match(styles, /@media\(max-width:700px\)[\s\S]*\.bank-activity-grid\{grid-template-columns:1fr/);
  assert.match(serviceWorker, /kurionyx-shell-v12/);
});
