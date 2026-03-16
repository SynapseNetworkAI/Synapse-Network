-- Publishable admin configuration center for menu topology.

CREATE TABLE IF NOT EXISTS admin_config_documents (
    config_key TEXT PRIMARY KEY,
    draft_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    published_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    draft_version INTEGER NOT NULL DEFAULT 1 CHECK (draft_version >= 1),
    published_version INTEGER NOT NULL DEFAULT 1 CHECK (published_version >= 1),
    updated_by TEXT REFERENCES admin_users(admin_id) ON DELETE SET NULL,
    published_by TEXT REFERENCES admin_users(admin_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);