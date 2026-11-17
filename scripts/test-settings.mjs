import assert from 'node:assert/strict';
import { loadSettings } from '../src/config/settings.js';

const defaults = loadSettings({ env: {} });

assert.equal(defaults.version, 1);
assert.equal(defaults.provider.timeoutMs, 30000);
assert.equal(defaults.keyPool.defaultCooldownMs, 30000);
assert.equal(defaults.router.credentialCooldownMs, 300000);
assert.equal(defaults.router.rateLimitCooldownMs, 30000);
assert.equal(defaults.router.maxAttempts, 3);
assert.equal(defaults.http.maxBodyBytes, 1048576);
assert.equal(defaults.database.maxConnections, 5);
assert.equal(defaults.database.idleTimeoutMs, 30000);
assert.equal(defaults.database.connectionTimeoutMs, 20000);

console.log('DEFAULT SETTINGS PRESERVATION: PASS');

const overridden = loadSettings({
  env: {
    VELZX_PROVIDER_TIMEOUT_MS: '45000',
    VELZX_KEY_COOLDOWN_MS: '35000',
    VELZX_CREDENTIAL_COOLDOWN_MS: '360000',
    VELZX_RATE_LIMIT_COOLDOWN_MS: '40000',
    VELZX_MAX_ATTEMPTS: '4',
    VELZX_HTTP_MAX_BODY_BYTES: '2097152',
    VELZX_DB_POOL_MAX: '8',
    VELZX_DB_IDLE_TIMEOUT_MS: '45000',
    VELZX_DB_CONNECTION_TIMEOUT_MS: '25000'
  }
});

assert.equal(overridden.provider.timeoutMs, 45000);
assert.equal(overridden.keyPool.defaultCooldownMs, 35000);
assert.equal(overridden.router.credentialCooldownMs, 360000);
assert.equal(overridden.router.rateLimitCooldownMs, 40000);
assert.equal(overridden.router.maxAttempts, 4);
assert.equal(overridden.http.maxBodyBytes, 2097152);
assert.equal(overridden.database.maxConnections, 8);
assert.equal(overridden.database.idleTimeoutMs, 45000);
assert.equal(overridden.database.connectionTimeoutMs, 25000);

console.log('ALL 9 ENVIRONMENT OVERRIDES: PASS');

// Unspecified settings must retain their defaults.
assert.equal(defaults.provider.timeoutMs, 30000);
assert.equal(defaults.keyPool.defaultCooldownMs, 30000);
assert.equal(defaults.router.credentialCooldownMs, 300000);
assert.equal(defaults.router.rateLimitCooldownMs, 30000);
assert.equal(defaults.router.maxAttempts, 3);
assert.equal(defaults.http.maxBodyBytes, 1048576);
assert.equal(defaults.database.maxConnections, 5);
assert.equal(defaults.database.idleTimeoutMs, 30000);
assert.equal(defaults.database.connectionTimeoutMs, 20000);

console.log('DEFAULT FALLBACK: PASS');

assert.ok(Object.isFrozen(defaults));
assert.ok(Object.isFrozen(defaults.provider));

console.log('IMMUTABLE SETTINGS: PASS');

assert.throws(
  () => loadSettings({
    env: { VELZX_MAX_ATTEMPTS: '0' }
  }),
  /INVALID_ENV_SETTING/
);

assert.throws(
  () => loadSettings({
    env: { VELZX_MAX_ATTEMPTS: 'abc' }
  }),
  /INVALID_ENV_SETTING/
);

console.log('INVALID CONFIGURATION REJECTION: PASS');
console.log('SETTINGS TEST: ALL PASSED');
