import assert from 'node:assert/strict';
import { createDatabasePool } from '../src/database/pool.js';

const env = {
  DATABASE_URL:
    'postgresql://test_user:test_password@localhost:5432/testdb?sslmode=require'
};

const settings = {
  database: {
    maxConnections: 8,
    idleTimeoutMs: 45000,
    connectionTimeoutMs: 25000
  }
};

const pool = createDatabasePool({ env, settings });

try {
  assert.equal(pool.options.max, 8);
  assert.equal(pool.options.idleTimeoutMillis, 45000);
  assert.equal(pool.options.connectionTimeoutMillis, 25000);
  assert.equal(pool.options.keepAlive, true);
  assert.equal(pool.options.application_name, 'velzx-ai');

  console.log('Database max connections override: PASS');
  console.log('Database idle timeout override: PASS');
  console.log('Database connection timeout override: PASS');
  console.log('Database pool defaults preservation: PASS');
  console.log('DATABASE POOL TEST: ALL PASSED');
} finally {
  await pool.end();
}
