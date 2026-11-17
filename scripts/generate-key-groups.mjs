import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';

const envPath = path.resolve(
  process.cwd(),
  '../VELZX-API-LABORATORIUM/.env'
);

const outputPath = path.resolve(
  'config/groups/key-groups.json'
);

if (fs.existsSync(outputPath)) {
  console.error('ABORT: konfigurasi grup sudah ada.');
  process.exit(1);
}

if (!fs.existsSync(envPath)) {
  console.error('ABORT: file sumber .env tidak ditemukan.');
  process.exit(1);
}

const content = fs.readFileSync(envPath, 'utf8');
const found = new Map();

for (const line of content.split(/\r?\n/)) {
  const match = line.match(
    /^\s*(GROQ_API_KEY\d+)\s*=\s*(.*?)\s*$/
  );

  if (!match) continue;

  const name = match[1];
  const value = match[2].replace(/^(['"])(.*)\1$/, '$2').trim();

  if (found.has(name)) {
    console.error(`ABORT: variabel duplikat ${name}`);
    process.exit(1);
  }

  if (value) found.set(name, true);
}

const expected = Array.from(
  { length: 35 },
  (_, i) => `GROQ_API_KEY${i + 1}`
);

const missing = expected.filter(name => !found.has(name));

if (found.size !== 35 || missing.length) {
  console.error('ABORT: inventaris tidak sesuai.');
  console.error(`Key terdeteksi: ${found.size}`);
  console.error(`Key tidak ditemukan: ${missing.length}`);
  process.exit(1);
}

const keys = [...found.keys()];

// Fisher-Yates cryptographic shuffle
for (let i = keys.length - 1; i > 0; i--) {
  const j = randomInt(i + 1);
  [keys[i], keys[j]] = [keys[j], keys[i]];
}

const config = {
  version: 1,
  strategy: 'random-once',
  totalKeys: 35,
  groups: {
    A: keys.slice(0, 12),
    B: keys.slice(12, 24),
    C: keys.slice(24, 35)
  }
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

fs.writeFileSync(
  outputPath,
  JSON.stringify(config, null, 2) + '\n',
  { mode: 0o600, flag: 'wx' }
);

console.log('PEMBAGIAN BERHASIL');
console.log('Group A: 12 key');
console.log('Group B: 12 key');
console.log('Group C: 11 key');
console.log('Total: 35 key');
console.log('Nilai API key tidak disalin.');
console.log('Konfigurasi: config/groups/key-groups.json');
