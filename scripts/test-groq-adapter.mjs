
import assert from 'node:assert/strict';
import {
  createGroqAdapter,
  GroqError
} from '../src/providers/groq/adapter.js';

function mockResponse(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    async text() {
      return JSON.stringify(body);
    }
  };
}

async function expectError(promise, code, status = null) {
  try {
    await promise;
    assert.fail(`Expected ${code}`);
  } catch (error) {
    assert.ok(error instanceof GroqError);
    assert.equal(error.code, code);

    if (status !== null) {
      assert.equal(error.status, status);
    }
  }
}

// Successful chat
const successAdapter = createGroqAdapter({
  fetchImpl: async () =>
    mockResponse(200, {
      choices: [{ message: { content: 'OK' } }]
    })
});

const result = await successAdapter.chat({
  key: 'TEST_ONLY',
  model: 'openai/gpt-oss-120b',
  messages: [{ role: 'user', content: 'Hello' }]
});

assert.equal(result.choices[0].message.content, 'OK');
console.log('Chat success: PASS');

// HTTP classifications
for (const [status, code] of [
  [400, 'GROQ_BAD_REQUEST'],
  [401, 'GROQ_INVALID_CREDENTIAL'],
  [403, 'GROQ_ACCESS_DENIED'],
  [429, 'GROQ_RATE_LIMITED'],
  [500, 'GROQ_SERVER_ERROR']
]) {
  const adapter = createGroqAdapter({
    fetchImpl: async () => mockResponse(status, {})
  });

  await expectError(
    adapter.discover({ key: 'TEST_ONLY' }),
    code,
    status
  );

  console.log(`HTTP ${status}: PASS`);
}

// Retry-After
const rateAdapter = createGroqAdapter({
  fetchImpl: async () =>
    mockResponse(429, {}, { 'retry-after': '5' })
});

try {
  await rateAdapter.discover({ key: 'TEST_ONLY' });
  assert.fail('Expected rate limit');
} catch (error) {
  assert.equal(error.retryAfterMs, 5000);
}

console.log('Retry-After: PASS');

// Network error
const networkAdapter = createGroqAdapter({
  fetchImpl: async () => {
    throw new Error('Network unavailable');
  }
});

await expectError(
  networkAdapter.discover({ key: 'TEST_ONLY' }),
  'GROQ_NETWORK_ERROR'
);

console.log('Network error: PASS');

// Timeout
const timeoutAdapter = createGroqAdapter({
  timeout: 10,
  fetchImpl: async (_, { signal }) =>
    new Promise((resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true }
      );
    })
});

await expectError(
  timeoutAdapter.discover({ key: 'TEST_ONLY' }),
  'GROQ_TIMEOUT'
);

console.log('Timeout: PASS');
console.log('GROQ ADAPTER TEST: ALL PASSED');
