CREATE TABLE IF NOT EXISTS provider_github_release_assets (
    asset_key TEXT PRIMARY KEY,
    repo TEXT NOT NULL,
    tag_name TEXT,
    latest BOOLEAN NOT NULL DEFAULT FALSE,
    asset_pattern TEXT,
    asset_name TEXT NOT NULL,
    signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
    storage_backend TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    download_status TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    response_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (size_bytes >= 0),
    CHECK (jsonb_typeof(response_json) = 'object')
);

CREATE INDEX IF NOT EXISTS provider_github_release_assets_repo_tag_idx
ON provider_github_release_assets (repo, tag_name, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_github_release_assets_expires_at_idx
ON provider_github_release_assets (expires_at);

CREATE TABLE IF NOT EXISTS provider_paper_pdf_assets (
    asset_key TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    paper_id TEXT,
    paper_url TEXT,
    title TEXT,
    authors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    publication_year INTEGER,
    doi TEXT,
    storage_backend TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    text_extract_job_id TEXT,
    download_status TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    response_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (size_bytes >= 0),
    CHECK (publication_year IS NULL OR publication_year >= 1900),
    CHECK (jsonb_typeof(authors_json) = 'array'),
    CHECK (jsonb_typeof(response_json) = 'object')
);

CREATE INDEX IF NOT EXISTS provider_paper_pdf_assets_source_paper_idx
ON provider_paper_pdf_assets (source_name, paper_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS provider_paper_pdf_assets_expires_at_idx
ON provider_paper_pdf_assets (expires_at);
