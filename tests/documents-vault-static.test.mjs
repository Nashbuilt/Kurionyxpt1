import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [migration, html, script, toolkit, worker] = await Promise.all([
  readFile(new URL('../supabase/migrations/20261023110000_documents_vault.sql', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.html', import.meta.url), 'utf8'),
  readFile(new URL('../documents.js', import.meta.url), 'utf8'),
  readFile(new URL('../toolkit.js', import.meta.url), 'utf8'),
  readFile(new URL('../sw.js', import.meta.url), 'utf8')
]);

test('document vault is private, workspace isolated and non-destructive', () => {
  assert.match(migration, /create table if not exists public\.business_documents/i);
  assert.match(migration, /create table if not exists public\.document_signatures/i);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /workspace_members[\s\S]*auth\.uid\(\)/);
  assert.match(migration, /'business-documents'[\s\S]*false[\s\S]*20971520/);
  assert.doesNotMatch(migration, /delete from public\.(business_documents|document_signatures)/i);
  assert.doesNotMatch(migration, /grant [^;]*delete on table public\.(business_documents|document_signatures)/i);
});

test('signatures are append-only and bound to an exact file hash', () => {
  assert.match(migration, /document_sha256_hex/);
  assert.match(migration, /unique \(document_id, signer_user_id\)/);
  assert.match(migration, /p_consent is not true/);
  assert.match(migration, /I have reviewed this exact document version/);
  assert.match(migration, /You have already signed this document version/);
});

test('Documents page separates legal files, receipts and other documents', () => {
  assert.match(html, /data-view="documents"/);
  assert.match(html, /data-panel="documents"/);
  assert.match(html, /Legal documents/);
  assert.match(html, /Receipts/);
  assert.match(html, /Other documents/);
  assert.match(html, /internal evidence trail, not a qualified trust-service signature/i);
});

test('browser upload hashes files and uses controlled database functions', () => {
  assert.match(script, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(script, /create_business_document/);
  assert.match(script, /sign_business_document/);
  assert.match(script, /archive_business_document/);
  assert.match(toolkit, /initDocuments/);
  assert.match(worker, /documents\.js/);
});
