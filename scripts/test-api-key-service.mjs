import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createApiKeyService } from '../src/auth/api-key-service.js';

const pepper = 'test-pepper-for-velzx-fortxx-auth-0001';
const fixedDate = new Date('2026-11-17T11:30:00.000Z');

const records = new Map();

const db = {
  async query(sql, values = []) {
    const statement = sql.replace(/\s+/g, ' ').trim();

    if (statement.startsWith('INSERT INTO public.api_keys')) {
      const [id, name, prefix, keyHash] = values;

      const row = {
        id,
        name,
        prefix,
        key_hash: keyHash,
        status: 'active',
        created_at: fixedDate,
        last_used_at: null,
        revoked_at: null
      };

      records.set(id, row);

      return {
        rowCount: 1,
        rows: [{
          id,
          name,
          prefix,
          status: 'active',
          created_at: fixedDate
        }]
      };
    }

    if (statement.startsWith('UPDATE public.api_keys SET last_used_at')) {
      const [keyHash, lastUsedAt] = values;
      const row = [...records.values()].find(
        item => item.key_hash === keyHash && item.status === 'active'
      );

      if (!row) return { rowCount: 0, rows: [] };

      row.last_used_at = lastUsedAt;

      return {
        rowCount: 1,
        rows: [{
          id: row.id,
          name: row.name,
          prefix: row.prefix,
          status: row.status
        }]
      };
    }

    if (statement.startsWith('SELECT id, name, prefix, status')) {
      return {
        rowCount: records.size,
        rows: [...records.values()]
          .sort((a, b) => b.created_at - a.created_at)
      };
    }

    if (statement.startsWith("UPDATE public.api_keys SET status = 'revoked'")) {
      const [id, revokedAt] = values;
      const row = records.get(id);

      if (!row || row.status !== 'active') {
        return { rowCount: 0, rows: [] };
      }

      row.status = 'revoked';
      row.revoked_at = revokedAt;

      return { rowCount: 1, rows: [{ id }] };
    }

    throw new Error('UNEXPECTED_SQL_QUERY');
  }
};

const service = createApiKeyService({
  db,
  env: { FORTXX_KEY_PEPPER: pepper },
  clock: () => fixedDate
});

const created = await service.createApiKey({
  name: 'Integration Test'
});

assert.match(created.apiKey, /^fx_live_[A-Za-z0-9_-]{43}$/);
assert.equal(created.key.name, 'Integration Test');
assert.equal(created.key.status, 'active');
assert.equal(created.key.prefix, created.apiKey.slice(0, 16));
assert.equal('key_hash' in created.key, false);
assert.equal('apiKey' in created.key, false);

const stored = records.get(created.key.id);
assert.ok(stored);
assert.notEqual(stored.key_hash, created.apiKey);
assert.equal(
  stored.key_hash,
  createHmac('sha256', pepper).update(created.apiKey).digest('hex')
);
console.log('API KEY CREATION + HASHING: PASS');

const authenticated = await service.authenticateApiKey(created.apiKey);
assert.equal(authenticated.id, created.key.id);
assert.equal(authenticated.name, 'Integration Test');
assert.equal(authenticated.status, 'active');
assert.equal(stored.last_used_at, fixedDate);
console.log('API KEY AUTHENTICATION: PASS');

assert.equal(await service.authenticateApiKey('invalid-token'), null);
assert.equal(await service.authenticateApiKey('fx_live_' + 'A'.repeat(43)), null);
console.log('INVALID TOKEN REJECTION: PASS');

const listed = await service.listApiKeys();
assert.equal(listed.length, 1);
assert.equal(listed[0].id, created.key.id);
assert.equal('key_hash' in listed[0], false);
assert.equal('apiKey' in listed[0], false);
console.log('SAFE API KEY LIST: PASS');

assert.equal(await service.revokeApiKey(created.key.id), true);
assert.equal(stored.status, 'revoked');
assert.ok(stored.revoked_at);
assert.equal(await service.revokeApiKey(created.key.id), false);
assert.equal(await service.authenticateApiKey(created.apiKey), null);
console.log('API KEY REVOCATION: PASS');

await assert.rejects(
  () => service.createApiKey({ name: '   ' }),
  { message: 'INVALID_API_KEY_NAME' }
);
console.log('INPUT VALIDATION: PASS');

console.log('API KEY SERVICE TEST: ALL PASSED');
