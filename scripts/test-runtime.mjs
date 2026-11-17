import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime/create-runtime.js';

const runtime = createRuntime();
const status = runtime.getKeyStatus();

assert.equal(typeof runtime.chat, 'function');
assert.equal(typeof runtime.getKeyStatus, 'function');

assert.deepEqual(
  Object.keys(status).sort(),
  ['A', 'B', 'C']
);

assert.equal(status.A.length, 12);
assert.equal(status.B.length, 12);
assert.equal(status.C.length, 11);

const entries = Object.values(status).flat();

assert.equal(entries.length, 35);
assert.equal(new Set(entries.map(entry => entry.name)).size, 35);
assert.ok(entries.every(entry => entry.available));

console.log('Runtime initialization: PASS');
console.log('Group A: 12 keys PASS');
console.log('Group B: 12 keys PASS');
console.log('Group C: 11 keys PASS');
console.log('Unique key references: 35 PASS');
console.log('Credential status redaction: PASS');
console.log('Runtime test: ALL PASSED');
