import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime/create-runtime.js';
import { createDatabasePool } from '../src/database/pool.js';
import { createApiKeyService } from '../src/auth/api-key-service.js';

let pool;
let service;
let created;
let revoked = false;

try {
  createRuntime();

  pool = createDatabasePool();

  await pool.query('SELECT 1');

  service = createApiKeyService({ db: pool });

  created = await service.createApiKey({
    name: 'FORTXX Neon Integration Test'
  });

  assert.ok(created.key.id);
  assert.equal(created.key.status, 'active');
  assert.ok(created.apiKey.startsWith('fx_live_'));

  console.log('NEON API KEY CREATION: PASS');

  const authenticated = await service.authenticateApiKey(created.apiKey);

  assert.equal(authenticated?.id, created.key.id);

  console.log('NEON API KEY AUTHENTICATION: PASS');

  const listed = await service.listApiKeys();
  const listedKey = listed.find(key => key.id === created.key.id);

  assert.ok(listedKey);
  assert.equal(listedKey.status, 'active');
  assert.equal('key_hash' in listedKey, false);
  assert.equal('apiKey' in listedKey, false);

  console.log('NEON SAFE KEY LIST: PASS');

  const revokeResult = await service.revokeApiKey(created.key.id);

  assert.equal(revokeResult, true);
  revoked = true;

  console.log('NEON API KEY REVOCATION: PASS');

  const afterRevoke = await service.authenticateApiKey(created.apiKey);

  assert.equal(afterRevoke, null);

  console.log('REVOKED KEY REJECTION: PASS');
  console.log('NEON API KEY INTEGRATION: ALL PASSED');

} catch (error) {
  console.log('NEON API KEY INTEGRATION: FAIL');
  console.log('Error code:', error.code ?? 'NO_CODE');
  console.log('Error name:', error.name ?? 'UNKNOWN');
  process.exitCode = 1;

} finally {
  if (created && service && !revoked) {
    await service.revokeApiKey(created.key.id).catch(() => {});
  }

  if (pool) {
    await pool.end().catch(() => {});
  }
}
