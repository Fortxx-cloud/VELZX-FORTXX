
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createKeyPool } from '../src/key-pool/key-pool.js';
import { createModelRouter } from '../src/model-router/router.js';

const groups = JSON.parse(
  fs.readFileSync('config/groups/key-groups.json', 'utf8')
);

const models = JSON.parse(
  fs.readFileSync('config/models/virtual-models.json', 'utf8')
);

const env = {};

for (const names of Object.values(groups.groups)) {
  for (const name of names) {
    env[name] = `TEST_ONLY_${name}`;
  }
}

function setup(adapter, maxAttempts = 3) {
  const keyPool = createKeyPool({
    groups: groups.groups,
    env
  });

  return createModelRouter({
    models,
    keyPool,
    adapter,
    maxAttempts
  });
}

const aliases = Object.keys(models.models);

assert.equal(aliases.length, 9);
console.log('Virtual model registry: PASS');

// Verify each alias routes to the correct upstream model and group.
for (const [alias, definition] of Object.entries(models.models)) {
  const calls = [];

  const router = setup({
    async chat(args) {
      calls.push(args);
      return { ok: true };
    }
  });

  const result = await router.chat({
    model: alias,
    messages: [{ role: 'user', content: 'test' }]
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, definition.upstream);
  assert.ok(groups.groups[definition.group].includes(
    calls[0].key.replace('TEST_ONLY_', '')
  ));

  console.log(`${alias}: PASS`);
}

// Rate-limit fallback.
{
  const calls = [];

  const router = setup({
    async chat(args) {
      calls.push(args);

      if (calls.length === 1) {
        const error = new Error('Rate limited');
        error.code = 'GROQ_RATE_LIMITED';
        error.retryable = true;
        error.retryAfterMs = 1000;
        throw error;
      }

      return { ok: true };
    }
  });

  const result = await router.chat({
    model: 'velzx-fortxx-pro',
    messages: [{ role: 'user', content: 'test' }]
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].key, calls[1].key);

  console.log('429 fallback: PASS');
}

// 400 must not rotate.
{
  let calls = 0;

  const router = setup({
    async chat() {
      calls++;
      const error = new Error('Bad request');
      error.code = 'GROQ_BAD_REQUEST';
      error.retryable = false;
      throw error;
    }
  });

  await assert.rejects(
    router.chat({
      model: 'velzx-fortxx-pro',
      messages: [{ role: 'user', content: 'test' }]
    }),
    error => error.code === 'GROQ_BAD_REQUEST'
  );

  assert.equal(calls, 1);

  console.log('400 no rotation: PASS');
}

// Unknown alias must be rejected.
{
  const router = setup({
    async chat() {
      throw new Error('Should not execute');
    }
  });

  await assert.rejects(
    router.chat({
      model: 'unknown-model',
      messages: [{ role: 'user', content: 'test' }]
    }),
    /UNKNOWN_VIRTUAL_MODEL/
  );

  console.log('Unknown model rejection: PASS');
}

console.log('MODEL ROUTER TEST: ALL PASSED');

// Configured credential cooldown.
{
  const cooldowns = [];
  const credentials = ['TEST_KEY_1', 'TEST_KEY_2'];
  let calls = 0;

  const keyPool = {
    acquire(group, { exclude = [] } = {}) {
      const name = credentials.find(item => !exclude.includes(item));
      if (!name) throw new Error('NO_HEALTHY_KEYS');
      return { name, value: name, role: 'backup' };
    },
    cooldown(name, durationMs) {
      cooldowns.push({ name, durationMs });
      return true;
    },
    markSuccess() {
      return true;
    }
  };

  const router = createModelRouter({
    models,
    keyPool,
    maxAttempts: 2,
    credentialCooldownMs: 12345,
    rateLimitCooldownMs: 6789,
    adapter: {
      async chat() {
        calls++;
        if (calls === 1) {
          const error = new Error('Invalid credential');
          error.code = 'GROQ_INVALID_CREDENTIAL';
          error.retryable = true;
          throw error;
        }
        return { ok: true };
      }
    }
  });

  await router.chat({
    model: 'velzx-fortxx-pro',
    messages: [{ role: 'user', content: 'test' }]
  });

  assert.equal(calls, 2);
  assert.equal(cooldowns.length, 1);
  assert.equal(cooldowns[0].durationMs, 12345);

  console.log('Credential cooldown override: PASS');
}

// Configured default rate-limit cooldown when Retry-After is absent.
{
  const cooldowns = [];
  const credentials = ['TEST_KEY_1', 'TEST_KEY_2'];
  let calls = 0;

  const keyPool = {
    acquire(group, { exclude = [] } = {}) {
      const name = credentials.find(item => !exclude.includes(item));
      if (!name) throw new Error('NO_HEALTHY_KEYS');
      return { name, value: name, role: 'backup' };
    },
    cooldown(name, durationMs) {
      cooldowns.push(durationMs);
      return true;
    },
    markSuccess() {
      return true;
    }
  };

  const router = createModelRouter({
    models,
    keyPool,
    maxAttempts: 2,
    rateLimitCooldownMs: 6789,
    adapter: {
      async chat() {
        calls++;
        if (calls === 1) {
          const error = new Error('Rate limited');
          error.code = 'GROQ_RATE_LIMITED';
          error.retryable = true;
          throw error;
        }
        return { ok: true };
      }
    }
  });

  await router.chat({
    model: 'velzx-fortxx-pro',
    messages: [{ role: 'user', content: 'test' }]
  });

  assert.equal(calls, 2);
  assert.deepEqual(cooldowns, [6789]);

  console.log('Rate-limit cooldown override: PASS');
}

// Configured maximum attempts.
{
  const credentials = ['TEST_KEY_1', 'TEST_KEY_2', 'TEST_KEY_3'];
  let calls = 0;

  const keyPool = {
    acquire(group, { exclude = [] } = {}) {
      const name = credentials.find(item => !exclude.includes(item));
      if (!name) throw new Error('NO_HEALTHY_KEYS');
      return { name, value: name, role: 'backup' };
    },
    cooldown() {
      return true;
    },
    markSuccess() {
      return true;
    }
  };

  const router = createModelRouter({
    models,
    keyPool,
    maxAttempts: 2,
    adapter: {
      async chat() {
        calls++;
        const error = new Error('Temporary provider failure');
        error.code = 'GROQ_SERVER_ERROR';
        error.retryable = true;
        throw error;
      }
    }
  });

  await assert.rejects(
    router.chat({
      model: 'velzx-fortxx-pro',
      messages: [{ role: 'user', content: 'test' }]
    }),
    error => error.code === 'GROQ_SERVER_ERROR'
  );

  assert.equal(calls, 2);

  console.log('Maximum attempts override: PASS');
}
