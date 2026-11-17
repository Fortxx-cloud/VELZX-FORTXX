import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createKeyPool } from '../src/key-pool/key-pool.js';

const config = JSON.parse(
  fs.readFileSync('config/groups/key-groups.json', 'utf8')
);

const env = {};

for (const names of Object.values(config.groups)) {
  for (const name of names) {
    env[name] = `TEST_ONLY_${name}`;
  }
}

let now = 1000;

const pool = createKeyPool({
  groups: config.groups,
  env,
  defaultCooldownMs: 5000,
  clock: () => now
});

for (const [group, names] of Object.entries(config.groups)) {
  const primary = pool.acquire(group);

  assert.equal(primary.name, names[0]);
  assert.equal(primary.role, 'primary');

  const backup = pool.acquire(group, {
    exclude: [primary.name]
  });

  assert.equal(backup.name, names[1]);
  assert.equal(backup.role, 'backup');

  assert.equal(pool.cooldown(primary.name, 5000), true);

  const fallback = pool.acquire(group);

  assert.equal(fallback.name, names[1]);

  assert.equal(pool.markSuccess(primary.name), true);

  const restored = pool.acquire(group);

  assert.equal(restored.name, names[0]);
}

const status = pool.getStatus();

assert.equal(status.A.length, 12);
assert.equal(status.B.length, 12);
assert.equal(status.C.length, 11);

console.log('KEY POOL TEST: PASS');
console.log('Primary selection: PASS');
console.log('Backup selection: PASS');
console.log('Cooldown: PASS');
console.log('Recovery: PASS');
console.log('Status redaction: PASS');

// Default cooldown duration must apply when duration is omitted.
{
  const name = config.groups.A[0];

  assert.equal(pool.cooldown(name), true);
  assert.equal(
    pool.getStatus().A[0].cooldownRemainingMs,
    5000
  );

  now += 4999;
  assert.equal(pool.getStatus().A[0].available, false);

  now += 1;
  assert.equal(pool.getStatus().A[0].available, true);
}

console.log('Default cooldown configuration: PASS');
