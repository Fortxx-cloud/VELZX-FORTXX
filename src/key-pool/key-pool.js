export function createKeyPool({
  groups,
  env,
  defaultCooldownMs = 30_000,
  clock = () => Date.now()
}) {
  if (!groups || !env) {
    throw new Error('KEY_POOL_CONFIG_MISSING');
  }

  const states = new Map();
  const owners = new Set();

  for (const [group, names] of Object.entries(groups)) {
    if (!Array.isArray(names) || names.length === 0) {
      throw new Error(`INVALID_GROUP:${group}`);
    }

    const entries = names.map((name, index) => {
      if (owners.has(name)) {
        throw new Error(`DUPLICATE_KEY_REFERENCE:${name}`);
      }

      owners.add(name);

      const value = env[name]?.trim();

      if (!value) {
        throw new Error(`MISSING_CREDENTIAL:${name}`);
      }

      return {
        name,
        value,
        role: index === 0 ? 'primary' : 'backup',
        cooldownUntil: 0
      };
    });

    states.set(group, entries);
  }

  function acquire(group, { exclude = [] } = {}) {
    const entries = states.get(group);

    if (!entries) {
      throw new Error(`UNKNOWN_GROUP:${group}`);
    }

    const excluded = new Set(exclude);
    const now = clock();

    const selected = entries.find(entry =>
      !excluded.has(entry.name) &&
      entry.cooldownUntil <= now
    );

    if (!selected) {
      const availableAt = entries
        .filter(entry => !excluded.has(entry.name))
        .map(entry => entry.cooldownUntil)
        .filter(time => time > now);

      const retryAfterMs = availableAt.length
        ? Math.min(...availableAt) - now
        : null;

      const error = new Error('NO_HEALTHY_KEYS');
      error.retryAfterMs = retryAfterMs;
      throw error;
    }

    return Object.freeze({
      name: selected.name,
      value: selected.value,
      role: selected.role
    });
  }

  function cooldown(name, durationMs = defaultCooldownMs) {
    for (const entries of states.values()) {
      const entry = entries.find(item => item.name === name);

      if (entry) {
        entry.cooldownUntil = Math.max(
          entry.cooldownUntil,
          clock() + Math.max(0, durationMs)
        );
        return true;
      }
    }

    return false;
  }

  function markSuccess(name) {
    for (const entries of states.values()) {
      const entry = entries.find(item => item.name === name);

      if (entry) {
        entry.cooldownUntil = 0;
        return true;
      }
    }

    return false;
  }

  function getStatus() {
    const now = clock();
    const result = {};

    for (const [group, entries] of states) {
      result[group] = entries.map(entry => ({
        name: entry.name,
        role: entry.role,
        available: entry.cooldownUntil <= now,
        cooldownRemainingMs: Math.max(
          0,
          entry.cooldownUntil - now
        )
      }));
    }

    return result;
  }

  return Object.freeze({
    acquire,
    cooldown,
    markSuccess,
    getStatus
  });
}
