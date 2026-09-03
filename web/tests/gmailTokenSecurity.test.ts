import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyGmailProxyRequest } from '../../supabase/functions/_shared/gmailProxyPolicy.ts';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '../..');
const read = (relativePath: string) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

test('Gmail proxy permits only the operations used by HexForge', () => {
  assert.equal(classifyGmailProxyRequest('/profile', 'GET')?.operation, 'gmail_read');
  assert.equal(classifyGmailProxyRequest('/threads/thread_1?format=full', 'GET')?.operation, 'gmail_read');
  assert.equal(
    classifyGmailProxyRequest('/messages?maxResults=100&q=is%3Aunread&pageToken=next_1', 'GET')?.operation,
    'gmail_read'
  );
  assert.equal(
    classifyGmailProxyRequest('/messages/message_1?format=metadata&metadataHeaders=Subject&metadataHeaders=Date', 'GET')?.operation,
    'gmail_read'
  );
  assert.equal(
    classifyGmailProxyRequest('/messages/message_1/attachments/attachment_1', 'GET')?.operation,
    'gmail_attachment'
  );
  assert.equal(classifyGmailProxyRequest('/drafts', 'POST')?.operation, 'gmail_write');
  assert.equal(classifyGmailProxyRequest('/messages/send', 'POST')?.operation, 'gmail_write');
});

test('Gmail proxy rejects arbitrary hosts, paths, methods, parameters, and oversized queries', () => {
  assert.equal(classifyGmailProxyRequest('//attacker.example/token', 'GET'), null);
  assert.equal(classifyGmailProxyRequest('https://attacker.example/token', 'GET'), null);
  assert.equal(classifyGmailProxyRequest('/settings/forwardingAddresses', 'GET'), null);
  assert.equal(classifyGmailProxyRequest('/profile', 'POST'), null);
  assert.equal(classifyGmailProxyRequest('/threads?maxResults=50&q=3d%20print', 'GET'), null);
  assert.equal(classifyGmailProxyRequest('/messages?maxResults=100&q=x&access_token=secret', 'GET'), null);
  assert.equal(classifyGmailProxyRequest(`/messages?maxResults=100&q=${'x'.repeat(1501)}`, 'GET'), null);
  assert.equal(classifyGmailProxyRequest('/messages/a/attachments/../../profile', 'GET'), null);
});

test('Gmail thread picker uses the deployed proxy-compatible list route', () => {
  const threadSource = read('web/src/api/google/gmail/threads.ts');
  assert.match(threadSource, /`\/messages\?maxResults=100&q=/);
  assert.doesNotMatch(threadSource, /`\/threads\?maxResults=/);
});

test('the web application can only delete legacy Google provider tokens', () => {
  const clientSource = read('web/src/api/google/gmail/client.ts');
  assert.doesNotMatch(clientSource, /localStorage\.setItem\s*\(/);
  assert.doesNotMatch(clientSource, /localStorage\.getItem\s*\(/);
  assert.doesNotMatch(clientSource, /captureGoogleProviderTokenFromUrl|syncGoogleProviderTokensFromSession/);
  assert.doesNotMatch(clientSource, /oauth2\.googleapis\.com\/token/);
  assert.match(clientSource, /localStorage\.removeItem\s*\(/);
});

test('Google token exchange and Gmail bearer use are confined to server functions', () => {
  const edgeClientSource = read('web/src/api/supabase/edgeFunctions.ts');
  assert.doesNotMatch(edgeClientSource, /refresh_token/);
  assert.doesNotMatch(edgeClientSource, /gmail\.googleapis\.com/);

  const proxySource = read('supabase/functions/gmail-proxy/index.ts');
  const credentialSource = read('supabase/functions/_shared/gmail.ts');
  assert.match(proxySource, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(credentialSource, /google-refresh-token/);
  assert.match(credentialSource, /encryptSecret/);
});

test('credential tables are inaccessible to browser database roles', () => {
  const migration = read('supabase/migrations/20260731120000_server_owned_gmail_credentials.sql');
  assert.match(migration, /revoke all on table public\.gmail_oauth_credentials from anon, authenticated/i);
  assert.match(migration, /revoke all on table public\.gmail_oauth_states from anon, authenticated/i);
  assert.doesNotMatch(migration, /create policy[\s\S]+gmail_oauth_credentials/i);
  assert.match(migration, /trg_remove_gmail_credential_when_access_ends/i);
});

test('OAuth state is consumed with one atomic delete-and-return operation', () => {
  const callbackSource = read('supabase/functions/gmail-oauth-callback/index.ts');
  assert.match(callbackSource, /gmail_oauth_states\?state_hash=eq\.\$\{stateHash\}/);
  assert.match(callbackSource, /method: 'DELETE'/);
  assert.match(callbackSource, /Prefer: 'return=representation'/);
  assert.doesNotMatch(callbackSource, /provider_token|provider_refresh_token/);
});

test('credential encryption authenticates the owning user and supports key versions', async () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const previousDeno = (globalThis as { Deno?: unknown }).Deno;
  (globalThis as { Deno?: unknown }).Deno = {
    env: {
      get: (name: string) => ({
        GMAIL_TOKEN_ENCRYPTION_KEY: key,
        GMAIL_TOKEN_ENCRYPTION_KEY_VERSION: '2'
      } as Record<string, string>)[name]
    }
  };

  try {
    const { decryptSecret, encryptSecret } = await import('../../supabase/functions/_shared/security.ts');
    const encrypted = await encryptSecret('refresh-token-value', 'user-1:google-refresh-token');
    assert.equal(encrypted.keyVersion, 2);
    assert.notEqual(encrypted.ciphertext, 'refresh-token-value');
    assert.equal(
      await decryptSecret(encrypted, 'user-1:google-refresh-token'),
      'refresh-token-value'
    );
    await assert.rejects(
      decryptSecret(encrypted, 'user-2:google-refresh-token')
    );
  } finally {
    (globalThis as { Deno?: unknown }).Deno = previousDeno;
  }
});
