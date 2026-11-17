import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRuntime } from './runtime/create-runtime.js';
import { createDatabasePool } from './database/pool.js';
import { createApiKeyService } from './auth/api-key-service.js';
import { createHttpServer } from './http/server.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

let database;
let server;

async function shutdown(signal) {
  console.log(`VELZX AI SHUTDOWN: ${signal}`);

  if (server) {
    await new Promise(resolve => server.close(resolve));
  }

  if (database) {
    await database.end().catch(() => {});
  }

  process.exit(0);
}

async function start() {
  const runtime = createRuntime();

  const models = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, 'config/models/virtual-models.json'),
      'utf8'
    )
  );

  database = createDatabasePool({ settings: runtime.settings });

  await database.query('SELECT 1');

  const apiKeyService = createApiKeyService({
    db: database
  });

  server = createHttpServer({
    runtime,
    apiKeyService,
    models,
    settings: runtime.settings
  });

  const rawPort = process.env.SERVER_PORT ?? process.env.PORT ?? '3000';
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('INVALID_SERVER_PORT');
  }

  server.on('error', error => {
    console.error('HTTP SERVER ERROR:', error.code ?? 'UNKNOWN');
    process.exitCode = 1;
  });

  server.listen(port, '0.0.0.0', () => {
    console.log('VELZX AI ONLINE');
    console.log(`HTTP SERVER: 0.0.0.0:${port}`);
    console.log('DATABASE: CONNECTED');
    console.log('AUTHENTICATION: ENABLED');
    console.log('MODEL COUNT:', Object.keys(models.models ?? models).length);
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

start().catch(async error => {
  console.error('VELZX AI STARTUP FAILED:', error.code ?? error.message ?? 'UNKNOWN');

  if (database) {
    await database.end().catch(() => {});
  }

  process.exitCode = 1;
});
