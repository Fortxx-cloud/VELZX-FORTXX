import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createKeyPool } from '../key-pool/key-pool.js';
import { createGroqAdapter } from '../providers/groq/adapter.js';
import { createModelRouter } from '../model-router/router.js';
import { loadSettings } from '../config/settings.js';

const PROJECT_ROOT = fileURLToPath(
  new URL('../../', import.meta.url)
);

const DEFAULT_ENV_PATH = path.resolve(
  PROJECT_ROOT,
  '../VELZX-API-LABORATORIUM/.env'
);

const DEFAULT_CONFIG_ENV_PATH = path.join(
  PROJECT_ROOT,
  '.env'
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function createRuntime({
  envPath = DEFAULT_ENV_PATH,
  configEnvPath = DEFAULT_CONFIG_ENV_PATH
} = {}) {
  if (configEnvPath !== null) {
    if (typeof configEnvPath !== 'string') {
      throw new Error('INVALID_CONFIG_ENV_PATH');
    }

    if (fs.existsSync(configEnvPath)) {
      if (typeof process.loadEnvFile !== 'function') {
        throw new Error('NODE_ENV_LOADER_UNAVAILABLE');
      }

      process.loadEnvFile(configEnvPath);
    }
  }

  if (envPath !== null) {
    if (typeof envPath !== 'string' || !fs.existsSync(envPath)) {
      throw new Error('SOURCE_ENV_NOT_FOUND');
    }

    if (typeof process.loadEnvFile !== 'function') {
      throw new Error('NODE_ENV_LOADER_UNAVAILABLE');
    }

    process.loadEnvFile(envPath);
  }

  const groupsConfig = readJson(
    path.join(PROJECT_ROOT, 'config/groups/key-groups.json')
  );

  const modelsConfig = readJson(
    path.join(PROJECT_ROOT, 'config/models/virtual-models.json')
  );

  const groups = groupsConfig.groups;
  const references = Object.values(groups).flat();

  if (
    references.length !== 35 ||
    new Set(references).size !== 35
  ) {
    throw new Error('INVALID_KEY_GROUP_CONFIGURATION');
  }

  for (const name of references) {
    if (
      typeof process.env[name] !== 'string' ||
      !process.env[name].trim()
    ) {
      throw new Error(`MISSING_CREDENTIAL:${name}`);
    }
  }

  const settings = loadSettings({ env: process.env });

  const keyPool = createKeyPool({
    groups,
    env: process.env,
    defaultCooldownMs: settings.keyPool.defaultCooldownMs
  });

  const adapter = createGroqAdapter({
    timeout: settings.provider.timeoutMs
  });

  const router = createModelRouter({
    models: modelsConfig,
    keyPool,
    adapter,
    maxAttempts: settings.router.maxAttempts,
    credentialCooldownMs: settings.router.credentialCooldownMs,
    rateLimitCooldownMs: settings.router.rateLimitCooldownMs
  });

  return Object.freeze({
    chat: request => router.chat(request),
    getKeyStatus: () => keyPool.getStatus(),
    settings
  });
}
