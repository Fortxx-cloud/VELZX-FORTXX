import assert from 'node:assert/strict';
import { createHttpServer } from '../src/http/server.js';
import { loadSettings } from '../src/config/settings.js';

const calls = [];

const runtime = {
  async chat(request) {
    calls.push(request);

    return {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      model: 'upstream-model',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'VELZX AI HTTP TEST',
          reasoning: 'INTERNAL_REASONING_MUST_NOT_LEAK'
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 3,
        total_tokens: 8
      },
      x_groq: { id: 'PRIVATE_PROVIDER_ID' },
      system_fingerprint: 'PRIVATE_FINGERPRINT',
      service_tier: 'PRIVATE_TIER'
    };
  }
};

const apiKeyService = {
  async authenticateApiKey(token) {
    return token === 'test-token'
      ? { id: 'test-id', status: 'active' }
      : null;
  }
};

const models = {
  models: {
    'velzx-fortxx-pro': {
      group: 'A',
      upstream: 'openai/gpt-oss-120b'
    },
    'velzx-fortxx-speed': {
      group: 'A',
      upstream: 'openai/gpt-oss-20b'
    }
  }
};

const server = createHttpServer({
  runtime,
  apiKeyService,
  models,
  settings: loadSettings({
    env: { VELZX_HTTP_MAX_BODY_BYTES: '256' }
  })
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const base = `http://127.0.0.1:${server.address().port}`;

async function request(path, options = {}) {
  return fetch(`${base}${path}`, options);
}

try {
  const health = await request('/health');
  assert.equal(health.status, 200);
  const healthData = await health.json();
  assert.equal(healthData.status, 'ok');
  assert.equal(healthData.service, 'VELZX AI');
  console.log('PUBLIC HEALTH ENDPOINT: PASS');

  const unauthorized = await request('/v1/models');
  assert.equal(unauthorized.status, 401);
  console.log('BEARER AUTHENTICATION: PASS');

  const invalid = await request('/v1/models', {
    headers: { Authorization: 'Bearer wrong-token' }
  });
  assert.equal(invalid.status, 401);
  console.log('INVALID API KEY REJECTION: PASS');

  const modelResponse = await request('/v1/models', {
    headers: { Authorization: 'Bearer test-token' }
  });

  const modelData = await modelResponse.json();

  assert.equal(modelResponse.status, 200);
  assert.equal(modelData.object, 'list');
  assert.equal(modelData.data.length, 2);
  assert.equal(modelData.data[0].owned_by, 'velzx-ai');
  console.log('OPENAI MODEL LIST: PASS');

  const chatResponse = await request('/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({
      model: 'velzx-fortxx-pro',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.5
    })
  });

  const chatData = await chatResponse.json();

  assert.equal(chatResponse.status, 200);
  assert.equal(chatData.model, 'velzx-fortxx-pro');
  assert.equal(chatData.choices[0].message.content, 'VELZX AI HTTP TEST');
  assert.equal('reasoning' in chatData.choices[0].message, false);
  assert.equal('x_groq' in chatData, false);
  assert.equal('system_fingerprint' in chatData, false);
  assert.equal('service_tier' in chatData, false);
  assert.equal(chatData.id, 'chatcmpl-test');
  assert.equal(chatData.usage.total_tokens, 8);
  assert.equal(calls[0].model, 'velzx-fortxx-pro');
  assert.equal(calls[0].temperature, 0.5);
  console.log('CHAT COMPLETIONS RESPONSE: PASS');

  const unknown = await request('/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'unknown-model',
      messages: [{ role: 'user', content: 'Hello' }]
    })
  });

  assert.equal(unknown.status, 400);
  console.log('UNKNOWN MODEL REJECTION: PASS');

  const streaming = await request('/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'velzx-fortxx-pro',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true
    })
  });

  assert.equal(streaming.status, 400);
  console.log('UNSUPPORTED STREAM REJECTION: PASS');

  const unsupportedType = await request('/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/jsonp'
    },
    body: JSON.stringify({
      model: 'velzx-fortxx-pro',
      messages: [{ role: 'user', content: 'Hello' }]
    })
  });

  assert.equal(unsupportedType.status, 415);
  console.log('STRICT CONTENT-TYPE VALIDATION: PASS');

  const badJson = await request('/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json'
    },
    body: '{invalid'
  });

  assert.equal(badJson.status, 400);
  console.log('INVALID JSON REJECTION: PASS');

  const oversizedBody = JSON.stringify({
    model: 'velzx-fortxx-pro',
    messages: [{ role: 'user', content: 'Hello' }]
  }) + ' '.repeat(300);

  const oversized = await request('/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json'
    },
    body: oversizedBody
  });

  assert.equal(oversized.status, 413);
  console.log('CONFIGURED HTTP BODY LIMIT: PASS');

  console.log('HTTP SERVER TEST: ALL PASSED');

} finally {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}
