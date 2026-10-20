import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, edgeFunction, config, settings] = await Promise.all([
  readFile(new URL('../supabase/migrations/20261019134500_monzo_oauth_connection.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/functions/monzo-oauth-callback/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8'),
  readFile(new URL('../settings.js', import.meta.url), 'utf8')
]);

test('Monzo tokens are stored through Vault and never exposed to browser roles', () => {
  assert.match(migration, /vault\.create_secret/i);
  assert.match(migration, /vault\.update_secret/i);
  assert.match(migration, /revoke all on table public\.monzo_oauth_states, public\.monzo_connections from public, anon, authenticated/i);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
  assert.doesNotMatch(settings, /MONZO_CLIENT_SECRET|access_token|refresh_token/i);
});

test('OAuth state is short-lived, single-use and owner-only', () => {
  assert.match(edgeFunction, /membership\.role !== 'owner'/);
  assert.match(edgeFunction, /10 \* 60 \* 1000/);
  assert.match(edgeFunction, /\.is\('used_at', null\)\.gt\('expires_at'/);
  assert.match(edgeFunction, /update\(\{ used_at:/);
});

test('callback refuses to connect a personal account', () => {
  assert.match(edgeFunction, /\/business\/i\.test/);
  assert.match(edgeFunction, /monzo=no_business_account/);
  assert.match(settings, /No personal account was connected/);
});

test('OAuth configuration ignores accidental surrounding whitespace', () => {
  assert.match(edgeFunction, /Deno\.env\.get\('MONZO_CLIENT_ID'\)\?\.trim\(\)/);
  assert.match(edgeFunction, /Deno\.env\.get\('MONZO_CLIENT_SECRET'\)\?\.trim\(\)/);
  assert.match(edgeFunction, /Deno\.env\.get\('MONZO_REDIRECT_URI'\)\?\.trim\(\)/);
});

test('public callback performs its own authentication checks', () => {
  assert.match(config, /\[functions\.monzo-oauth-callback\][\s\S]*verify_jwt = false/);
  assert.match(edgeFunction, /auth\.getUser\(\)/);
  assert.match(edgeFunction, /userClient[\s\S]*\.from\('workspace_members'\)/);
  assert.match(edgeFunction, /membershipError/);
  assert.match(edgeFunction, /crypto\.randomUUID\(\)/);
});

test('settings provides a real owner-gated Monzo connection control', () => {
  assert.match(settings, /data-connect-monzo/);
  assert.match(settings, /functions\.invoke\('monzo-oauth-callback'/);
  assert.match(settings, /error\?\.context[\s\S]*error\.context\.json/);
  assert.match(settings, /state\.isOwner \? '' : 'disabled'/);
});
