import { createRuntime } from '../src/runtime/create-runtime.js';
import { createDatabasePool } from '../src/database/pool.js';
import { createApiKeyService } from '../src/auth/api-key-service.js';

const name = process.argv.slice(2).join(' ').trim();

if (!name) {
  console.error('Usage: node scripts/create-api-key.mjs "Application Name"');
  process.exit(1);
}

let pool;

try {
  createRuntime();

  pool = createDatabasePool();

  await pool.query('SELECT 1');

  const service = createApiKeyService({ db: pool });

  const created = await service.createApiKey({ name });

  console.log('\nFORTXX API KEY CREATED');
  console.log('Name:', created.key.name);
  console.log('ID:', created.key.id);
  console.log('Status:', created.key.status);
  console.log('\nAPI KEY (SHOW ONCE):');
  console.log(created.apiKey);
  console.log('\nStore this token securely. It cannot be retrieved again.');

} catch (error) {
  console.error('API KEY CREATION FAILED:', error.code ?? error.message ?? 'UNKNOWN');
  process.exitCode = 1;
} finally {
  if (pool) await pool.end().catch(() => {});
}
