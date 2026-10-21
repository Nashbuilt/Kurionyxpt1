import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, toolkit, markup, styles] = await Promise.all([
  readFile(new URL('../supabase/migrations/20261021131017_profile_audit_attribution.sql', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.js', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.html', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8')
]);

test('operational records capture creating and modifying users without guessing history', () => {
  for (const table of ['stock_items', 'stock_sales', 'expenses', 'shipments', 'income_records']) assert.match(migration, new RegExp(`'${table}'`));
  assert.match(migration, /add column if not exists created_by uuid/i);
  assert.match(migration, /add column if not exists updated_by uuid/i);
  assert.match(migration, /new\.updated_by = auth\.uid\(\)/i);
  assert.doesNotMatch(migration, /update public\.[a-z_]+ set (created_by|updated_by)/i);
});

test('users without an avatar receive a required profile setup flow', () => {
  assert.match(markup, /id="profile-setup-modal"/);
  assert.match(toolkit, /if \(!membership\.avatar_path\) profileSetupDialog\.showModal\(\)/);
  assert.match(toolkit, /profileSetupDialog\.addEventListener\('cancel', event => event\.preventDefault\(\)\)/);
  assert.match(toolkit, /set_my_workspace_avatar/);
});

test('record actor avatars provide desktop details and compact mobile display', () => {
  assert.match(toolkit, /function actorBadge/);
  assert.match(toolkit, /actor\.name.*shortDate\(timestamp\)/s);
  assert.match(toolkit, /function renderActorBadges/);
  assert.match(styles, /\.record-actor/);
  assert.match(styles, /@media\(max-width:800px\)[\s\S]*\.record-actor/);
});
