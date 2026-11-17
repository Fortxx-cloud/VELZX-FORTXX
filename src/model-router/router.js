
export function createModelRouter({
  models,
  keyPool,
  adapter,
  maxAttempts = 3,
  credentialCooldownMs = 300000,
  rateLimitCooldownMs = 30000
}) {
  if (!models || !keyPool || !adapter) {
    throw new Error('MODEL_ROUTER_CONFIG_MISSING');
  }

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('INVALID_MAX_ATTEMPTS');
  }

  const registry = models.models ?? models;

  async function chat({
    model,
    messages,
    ...options
  }) {
    const definition = registry[model];

    if (!definition) {
      throw new Error('UNKNOWN_VIRTUAL_MODEL');
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('INVALID_MESSAGES');
    }

    const attempted = [];
    let lastError;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let credential;

      try {
        credential = keyPool.acquire(definition.group, {
          exclude: attempted
        });
      } catch (error) {
        if (error.message === 'NO_HEALTHY_KEYS') {
          if (lastError) throw lastError;
          throw error;
        }
        throw error;
      }

      attempted.push(credential.name);

      try {
        const result = await adapter.chat({
          key: credential.value,
          model: definition.upstream,
          messages,
          ...options
        });

        keyPool.markSuccess(credential.name);

        return result;
      } catch (error) {
        lastError = error;

        const code = error.code;

        if (
          code === 'GROQ_INVALID_CREDENTIAL' ||
          code === 'GROQ_ACCESS_DENIED'
        ) {
          keyPool.cooldown(
            credential.name,
            credentialCooldownMs
          );
        } else if (code === 'GROQ_RATE_LIMITED') {
          keyPool.cooldown(
            credential.name,
            error.retryAfterMs ??
              rateLimitCooldownMs
          );
        } else if (!error.retryable) {
          throw error;
        }
      }
    }

    throw lastError ?? new Error('MODEL_REQUEST_FAILED');
  }

  return Object.freeze({ chat });
}
