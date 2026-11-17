import {
  createHmac,
  randomBytes,
  randomUUID
} from 'node:crypto';

const TOKEN_PREFIX = 'fx_live_';
const TOKEN_PATTERN = /^fx_live_[A-Za-z0-9_-]{43}$/;

function hashToken(token, pepper) {
  return createHmac('sha256', pepper)
    .update(token, 'utf8')
    .digest('hex');
}

function validateName(name) {
  if (typeof name !== 'string') {
    throw new Error('INVALID_API_KEY_NAME');
  }

  const normalized = name.trim();

  if (!normalized || normalized.length > 100) {
    throw new Error('INVALID_API_KEY_NAME');
  }

  return normalized;
}

export function createApiKeyService({
  db,
  env = process.env,
  clock = () => new Date()
} = {}) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('DATABASE_CLIENT_REQUIRED');
  }

  const pepper = env.FORTXX_KEY_PEPPER;

  if (typeof pepper !== 'string' || pepper.length < 32) {
    throw new Error('FORTXX_KEY_PEPPER_REQUIRED');
  }

  return Object.freeze({
    async createApiKey({ name }) {
      const normalizedName = validateName(name);
      const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
      const prefix = token.slice(0, 16);
      const keyHash = hashToken(token, pepper);
      const id = randomUUID();

      const result = await db.query(
        `INSERT INTO public.api_keys
          (id, name, prefix, key_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, prefix, status, created_at`,
        [id, normalizedName, prefix, keyHash]
      );

      const row = result.rows[0];

      if (!row) {
        throw new Error('API_KEY_CREATE_FAILED');
      }

      return {
        apiKey: token,
        key: {
          id: row.id,
          name: row.name,
          prefix: row.prefix,
          status: row.status,
          createdAt: row.created_at
        }
      };
    },

    async authenticateApiKey(token) {
      if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
        return null;
      }

      const keyHash = hashToken(token, pepper);

      const result = await db.query(
        `UPDATE public.api_keys
         SET last_used_at = $2
         WHERE key_hash = $1 AND status = 'active'
         RETURNING id, name, prefix, status`,
        [keyHash, clock()]
      );

      if (result.rowCount !== 1) {
        return null;
      }

      return {
        id: result.rows[0].id,
        name: result.rows[0].name,
        prefix: result.rows[0].prefix,
        status: result.rows[0].status
      };
    },

    async listApiKeys() {
      const result = await db.query(
        `SELECT id, name, prefix, status,
                created_at, last_used_at, revoked_at
         FROM public.api_keys
         ORDER BY created_at DESC`
      );

      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        status: row.status,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        revokedAt: row.revoked_at
      }));
    },

    async revokeApiKey(id) {
      if (typeof id !== 'string' || !id.trim()) {
        throw new Error('INVALID_API_KEY_ID');
      }

      const result = await db.query(
        `UPDATE public.api_keys
         SET status = 'revoked', revoked_at = $2
         WHERE id = $1 AND status = 'active'
         RETURNING id`,
        [id, clock()]
      );

      return result.rowCount === 1;
    }
  });
}
