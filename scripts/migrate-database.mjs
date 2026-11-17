import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createRuntime } from '../src/runtime/create-runtime.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIGRATION_ID = '001_create_api_keys';

let pool;
let client;
let transactionStarted = false;

try {
  createRuntime();

  const connectionString = process.env.DIRECT_URL;

  if (!connectionString) {
    throw new Error('DIRECT_URL_REQUIRED');
  }

  const url = new URL(connectionString);

  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    url.pathname.length < 2 ||
    url.searchParams.get('sslmode') !== 'require'
  ) {
    throw new Error('INVALID_DIRECT_DATABASE_CONFIGURATION');
  }

  pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 20000,
    application_name: 'velzx-fortxx-migrations'
  });

  client = await pool.connect();

  await client.query('BEGIN');
  transactionStarted = true;

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      migration_id VARCHAR(150) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const existing = await client.query(
    'SELECT migration_id FROM public.schema_migrations WHERE migration_id = $1',
    [MIGRATION_ID]
  );

  if (existing.rowCount > 0) {
    await client.query('COMMIT');
    transactionStarted = false;
    console.log('Migration already applied: PASS');
  } else {
    const sql = fs.readFileSync(
      path.join(ROOT, 'migrations', `${MIGRATION_ID}.sql`),
      'utf8'
    );

    await client.query(sql);

    await client.query(
      'INSERT INTO public.schema_migrations (migration_id) VALUES ($1)',
      [MIGRATION_ID]
    );

    await client.query('COMMIT');
    transactionStarted = false;

    console.log('Migration applied: PASS');
  }

  const verification = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'api_keys'
    ORDER BY ordinal_position
  `);

  const required = [
    'id',
    'name',
    'prefix',
    'key_hash',
    'status',
    'created_at',
    'last_used_at',
    'revoked_at'
  ];

  const actual = verification.rows.map(row => row.column_name);

  if (!required.every(column => actual.includes(column))) {
    throw new Error('API_KEYS_SCHEMA_VERIFICATION_FAILED');
  }

  console.log('API keys schema verification: PASS');
  console.log('Verified columns:', actual.length);
  console.log('Migration tracking: PASS');

} catch (error) {
  if (transactionStarted && client) {
    await client.query('ROLLBACK').catch(() => {});
  }

  console.log('DATABASE MIGRATION: FAIL');
  console.log('Error code:', error.code ?? 'NO_CODE');
  console.log('Error name:', error.name ?? 'UNKNOWN');
  process.exitCode = 1;

} finally {
  client?.release();
  if (pool) await pool.end().catch(() => {});
}
