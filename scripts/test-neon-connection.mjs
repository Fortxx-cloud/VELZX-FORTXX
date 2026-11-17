import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime/create-runtime.js';
import { createDatabasePool } from '../src/database/pool.js';

let pool;

try {
  // Memuat environment laboratorium dan FORTXX.
  createRuntime();

  pool = createDatabasePool();

  const result = await pool.query('SELECT 1 AS ok');

  assert.equal(Number(result.rows[0]?.ok), 1);

  console.log('Neon PostgreSQL connection: PASS');
  console.log('Database query: PASS');
  console.log('Connection configuration: PASS');
} catch (error) {
  console.log('Neon PostgreSQL connection: FAIL');
  console.log('Error code:', error.code ?? error.name);
  process.exitCode = 1;
} finally {
  if (pool) {
    await pool.end().catch(() => {
      console.log('Pool cleanup: WARNING');
    });
  }
}
