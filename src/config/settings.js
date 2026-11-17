import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONFIG_PATH = fileURLToPath(
  new URL('../../config/runtime-settings.json', import.meta.url)
);

const ENV_OVERRIDES = {
  VELZX_PROVIDER_TIMEOUT_MS: ['provider', 'timeoutMs'],
  VELZX_KEY_COOLDOWN_MS: ['keyPool', 'defaultCooldownMs'],
  VELZX_CREDENTIAL_COOLDOWN_MS: ['router', 'credentialCooldownMs'],
  VELZX_RATE_LIMIT_COOLDOWN_MS: ['router', 'rateLimitCooldownMs'],
  VELZX_MAX_ATTEMPTS: ['router', 'maxAttempts'],
  VELZX_HTTP_MAX_BODY_BYTES: ['http', 'maxBodyBytes'],
  VELZX_DB_POOL_MAX: ['database', 'maxConnections'],
  VELZX_DB_IDLE_TIMEOUT_MS: ['database', 'idleTimeoutMs'],
  VELZX_DB_CONNECTION_TIMEOUT_MS: ['database', 'connectionTimeoutMs']
};

function setNestedValue(target, pathParts, value) {
  let current = target;

  for (const part of pathParts.slice(0, -1)) {
    current = current[part];
  }

  current[pathParts.at(-1)] = value;
}

function validateSettings(settings) {
  if (!settings || settings.version !== 1) {
    throw new Error('INVALID_SETTINGS_VERSION');
  }

  for (const [section, fields] of Object.entries({
    provider: ['timeoutMs'],
    keyPool: ['defaultCooldownMs'],
    router: ['credentialCooldownMs', 'rateLimitCooldownMs', 'maxAttempts'],
    http: ['maxBodyBytes'],
    database: ['maxConnections', 'idleTimeoutMs', 'connectionTimeoutMs']
  })) {
    for (const field of fields) {
      const value = settings[section]?.[field];

      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`INVALID_SETTING:${section}.${field}`);
      }
    }
  }

  return settings;
}

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }

  return Object.freeze(value);
}

export function loadSettings({
  configPath = DEFAULT_CONFIG_PATH,
  env = process.env
} = {}) {
  if (typeof configPath !== 'string' || !configPath.trim()) {
    throw new Error('INVALID_SETTINGS_PATH');
  }

  let settings;

  try {
    settings = JSON.parse(
      fs.readFileSync(path.resolve(configPath), 'utf8')
    );
  } catch {
    throw new Error('SETTINGS_FILE_READ_FAILED');
  }

  for (const [envName, settingPath] of Object.entries(ENV_OVERRIDES)) {
    if (env[envName] === undefined) continue;

    const rawValue = env[envName];

    if (
      typeof rawValue !== 'string' ||
      !/^[1-9]\d*$/.test(rawValue.trim())
    ) {
      throw new Error(`INVALID_ENV_SETTING:${envName}`);
    }

    const value = Number(rawValue);

    if (!Number.isSafeInteger(value)) {
      throw new Error(`INVALID_ENV_SETTING:${envName}`);
    }

    setNestedValue(settings, settingPath, value);
  }

  validateSettings(settings);

  return deepFreeze(settings);
}
