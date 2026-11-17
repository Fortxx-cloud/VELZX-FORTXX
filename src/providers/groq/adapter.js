
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_TIMEOUT = 30_000;

export class GroqError extends Error {
  constructor(code, {
    status = null,
    retryable = false,
    retryAfterMs = null
  } = {}) {
    super(code);
    this.name = 'GroqError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfter(value) {
  if (!value) return null;

  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const date = Date.parse(value);

  if (Number.isNaN(date)) return null;

  return Math.max(0, date - Date.now());
}

export function createGroqAdapter({
  baseUrl = DEFAULT_BASE_URL,
  timeout = DEFAULT_TIMEOUT,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('FETCH_UNAVAILABLE');
  }

  const root = baseUrl.replace(/\/+$/, '');

  async function request(route, {
    key,
    method = 'GET',
    body
  } = {}) {
    if (!key) {
      throw new GroqError('MISSING_CREDENTIAL');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetchImpl(`${root}/${route}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal
      });

      const raw = await response.text();
      let data = {};

      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          if (response.ok) {
            throw new GroqError('INVALID_PROVIDER_RESPONSE', {
              status: response.status
            });
          }
        }
      }

      if (!response.ok) {
        const status = response.status;

        const retryAfterMs = parseRetryAfter(
          response.headers.get('retry-after')
        );

        const classification = {
          400: ['GROQ_BAD_REQUEST', false],
          401: ['GROQ_INVALID_CREDENTIAL', false],
          403: ['GROQ_ACCESS_DENIED', false],
          429: ['GROQ_RATE_LIMITED', true]
        };

        const [code, retryable] =
          classification[status] ??
          (status >= 500
            ? ['GROQ_SERVER_ERROR', true]
            : ['GROQ_HTTP_ERROR', false]);

        throw new GroqError(code, {
          status,
          retryable,
          retryAfterMs
        });
      }

      return data;
    } catch (error) {
      if (error instanceof GroqError) throw error;

      if (controller.signal.aborted || error.name === 'AbortError') {
        throw new GroqError('GROQ_TIMEOUT', {
          retryable: true
        });
      }

      throw new GroqError('GROQ_NETWORK_ERROR', {
        retryable: true
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    discover({ key }) {
      return request('models', { key });
    },

    chat({ key, model, messages, ...options }) {
      if (!model || !Array.isArray(messages)) {
        throw new GroqError('INVALID_CHAT_ARGUMENTS');
      }

      return request('chat/completions', {
        key,
        method: 'POST',
        body: {
          model,
          messages,
          ...options
        }
      });
    }
  });
}
