import { Pool } from 'pg';
import { loadSettings } from '../config/settings.js';

export function createDatabasePool({
  env = process.env,
  settings = loadSettings({ env })
} = {}) {
  const connectionString = env.DATABASE_URL;

  if (typeof connectionString !== 'string' || !connectionString.trim()) {
    throw new Error('DATABASE_URL_REQUIRED');
  }

  let parsed;

  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('INVALID_DATABASE_URL');
  }

  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    !parsed.username ||
    !parsed.password ||
    parsed.pathname.length < 2 ||
    parsed.searchParams.get('sslmode') !== 'require'
  ) {
    throw new Error('INVALID_DATABASE_CONFIGURATION');
  }

  return new Pool({
    connectionString,
    max: settings.database.maxConnections,
    idleTimeoutMillis: settings.database.idleTimeoutMs,
    connectionTimeoutMillis: settings.database.connectionTimeoutMs,
    keepAlive: true,
    application_name: 'velzx-ai'
  });
}
