import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = readFileSync(new URL('../settings.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261020195429_workspace_member_profile_pictures.sql', import.meta.url), 'utf8');

test('profile pictures use a private constrained bucket', () => {
  assert.match(migration, /'profile-pictures', 'profile-pictures', false, 5242880/);
  assert.match(migration, /image\/jpeg.*image\/png.*image\/webp/);
});

test('uploads are restricted to the signed-in member folder', () => {
  assert.match(migration, /foldername\(name\)\)\[2\] = \(select auth\.uid\(\)\)::text/);
  assert.match(migration, /set_my_workspace_avatar/);
  assert.match(migration, /expected_prefix := p_workspace_id::text \|\| '\/' \|\| current_user_id::text/);
  assert.match(migration, /revoke all on function public\.set_my_workspace_avatar\(bigint, text\) from public, anon/);
  assert.match(migration, /member\.display_name::text/);
  assert.match(migration, /member\.role::text/);
});

test('settings validates and uploads profile pictures without overwriting paths', () => {
  assert.match(settings, /image\/jpeg.*image\/png.*image\/webp/);
  assert.match(settings, /5 \* 1024 \* 1024/);
  assert.match(settings, /crypto\.randomUUID\(\)/);
  assert.match(settings, /upsert: false/);
  assert.match(settings, /data-change-profile-photo/);
});
