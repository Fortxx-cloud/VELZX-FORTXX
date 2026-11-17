CREATE TABLE public.api_keys (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    prefix VARCHAR(32) NOT NULL,
    key_hash CHAR(64) NOT NULL UNIQUE,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,

    CONSTRAINT api_keys_status_check
      CHECK (status IN ('active', 'revoked')),

    CONSTRAINT api_keys_revocation_check
      CHECK (
        (status = 'active' AND revoked_at IS NULL)
        OR
        (status = 'revoked' AND revoked_at IS NOT NULL)
      )
);

CREATE INDEX api_keys_created_at_idx
ON public.api_keys (created_at DESC);

CREATE INDEX api_keys_active_idx
ON public.api_keys (id)
WHERE status = 'active';
