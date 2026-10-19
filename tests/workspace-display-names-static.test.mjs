import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, settings] = await Promise.all([
  readFile(new URL('../supabase/migrations/20261019113500_workspace_member_display_names.sql', import.meta.url), 'utf8'),
  readFile(new URL('../settings.js', import.meta.url), 'utf8')
]);

test('known Kurionyx accounts receive application display names', () => {
  assert.match(migration, /a4e71697-51d1-4866-9cde-542abcceab90[\s\S]*?Nyasha/i);
  assert.match(migration, /2f3afed4-7020-465e-9926-84503f793fa2[\s\S]*?Jonathan/i);
  assert.match(migration, /do not establish legal ownership/i);
});

test('team settings prefer display names while retaining account email', () => {
  assert.match(settings, /member\.display_name \|\| member\.email/);
  assert.match(settings, /member\.email \? `\$\{esc\(member\.email\)\} · `/);
});

test('member list remains workspace-authorised', () => {
  assert.match(migration, /current_member\.workspace_id = p_workspace_id/i);
  assert.match(migration, /current_member\.user_id = auth\.uid\(\)/i);
  assert.match(migration, /revoke all on function public\.list_workspace_members\(bigint\) from public, anon/i);
});
