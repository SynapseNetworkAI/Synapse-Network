-- Synapse Gateway Admin PostgreSQL bootstrap schema
-- First-phase control-plane database: identity, RBAC, approval workflow, execution, audit.

CREATE TABLE IF NOT EXISTS admin_users (
    admin_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    auth_source TEXT NOT NULL DEFAULT 'bootstrap',
    sso_subject TEXT,
    password_hash TEXT,
    require_mfa BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    disabled_at TIMESTAMPTZ,
    CHECK (status IN ('active', 'disabled', 'locked', 'pending_invite')),
    CHECK (auth_source IN ('bootstrap', 'sso', 'oidc'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_users_email_ci
ON admin_users (lower(email));

CREATE INDEX IF NOT EXISTS idx_admin_users_status_updated_at
ON admin_users (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_users_sso_subject
ON admin_users (sso_subject);

CREATE TABLE IF NOT EXISTS admin_mfa_factors (
    factor_id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admin_users(admin_id) ON DELETE RESTRICT,
    factor_type TEXT NOT NULL,
    factor_label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    secret_ref TEXT,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    CHECK (factor_type IN ('totp', 'webauthn', 'backup_code')),
    CHECK (status IN ('pending', 'active', 'revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_mfa_factor_identity
ON admin_mfa_factors (admin_id, factor_type, factor_label);

CREATE INDEX IF NOT EXISTS idx_admin_mfa_factors_admin_status
ON admin_mfa_factors (admin_id, status);

CREATE TABLE IF NOT EXISTS admin_sessions (
    session_id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admin_users(admin_id) ON DELETE RESTRICT,
    token_jti TEXT NOT NULL,
    refresh_token_hash TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    mfa_verified_at TIMESTAMPTZ,
    client_ip TEXT,
    user_agent TEXT,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('active', 'revoked', 'expired', 'locked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_sessions_token_jti
ON admin_sessions (token_jti);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_status_expires
ON admin_sessions (admin_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at
ON admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS admin_roles (
    role_key TEXT PRIMARY KEY,
    role_name TEXT NOT NULL,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT TRUE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('active', 'disabled'))
);

CREATE TABLE IF NOT EXISTS admin_permissions (
    permission_key TEXT PRIMARY KEY,
    resource_domain TEXT NOT NULL,
    action TEXT NOT NULL,
    risk_level TEXT NOT NULL DEFAULT 'low',
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (risk_level IN ('low', 'medium', 'high', 'critical'))
);

CREATE INDEX IF NOT EXISTS idx_admin_permissions_domain_action
ON admin_permissions (resource_domain, action);

CREATE TABLE IF NOT EXISTS admin_role_permissions (
    role_key TEXT NOT NULL REFERENCES admin_roles(role_key) ON DELETE RESTRICT,
    permission_key TEXT NOT NULL REFERENCES admin_permissions(permission_key) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    PRIMARY KEY (role_key, permission_key)
);

CREATE TABLE IF NOT EXISTS admin_user_role_bindings (
    binding_id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admin_users(admin_id) ON DELETE RESTRICT,
    role_key TEXT NOT NULL REFERENCES admin_roles(role_key) ON DELETE RESTRICT,
    scope_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'active',
    granted_by TEXT,
    grant_reason TEXT,
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('active', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_admin_user_role_bindings_admin_status
ON admin_user_role_bindings (admin_id, status);

CREATE INDEX IF NOT EXISTS idx_admin_user_role_bindings_role_status
ON admin_user_role_bindings (role_key, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_user_role_bindings_active
ON admin_user_role_bindings (admin_id, role_key)
WHERE status = 'active';

CREATE TABLE IF NOT EXISTS admin_approvals (
    approval_id TEXT PRIMARY KEY,
    approval_type TEXT NOT NULL,
    approval_level TEXT NOT NULL,
    status TEXT NOT NULL,
    requester_id TEXT NOT NULL REFERENCES admin_users(admin_id) ON DELETE RESTRICT,
    current_approver_id TEXT REFERENCES admin_users(admin_id) ON DELETE RESTRICT,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    owner_address TEXT,
    tx_hash TEXT,
    event_key TEXT,
    risk_level TEXT NOT NULL DEFAULT 'green',
    amount_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    reason TEXT NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    request_id TEXT,
    trace_id TEXT,
    submitted_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    executed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (approval_level IN ('L1', 'L2', 'L3', 'L4')),
    CHECK (status IN (
        'DRAFT',
        'SUBMITTED',
        'UNDER_REVIEW',
        'APPROVED_PENDING_EXECUTION',
        'EXECUTING',
        'EXECUTED',
        'REJECTED',
        'CANCELLED',
        'FAILED',
        'EXPIRED'
    )),
    CHECK (risk_level IN ('green', 'yellow', 'red')),
    CHECK (amount_usdc >= 0)
);

CREATE INDEX IF NOT EXISTS idx_admin_approvals_status_created_at
ON admin_approvals (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_approvals_type_status_created_at
ON admin_approvals (approval_type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_approvals_requester_created_at
ON admin_approvals (requester_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_approvals_current_approver
ON admin_approvals (current_approver_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_approvals_resource
ON admin_approvals (resource_type, resource_id);

CREATE INDEX IF NOT EXISTS idx_admin_approvals_tx_hash
ON admin_approvals (tx_hash);

CREATE TABLE IF NOT EXISTS admin_approval_steps (
    step_id TEXT PRIMARY KEY,
    approval_id TEXT NOT NULL REFERENCES admin_approvals(approval_id) ON DELETE CASCADE,
    step_no INTEGER NOT NULL,
    required_role TEXT,
    required_permission TEXT,
    approver_id TEXT REFERENCES admin_users(admin_id) ON DELETE RESTRICT,
    decision TEXT,
    decision_comment TEXT,
    assigned_at TIMESTAMPTZ,
    decided_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (step_no > 0),
    CHECK (decision IS NULL OR decision IN ('APPROVE', 'REJECT', 'ESCALATE', 'SKIP'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_approval_steps_order
ON admin_approval_steps (approval_id, step_no);

CREATE INDEX IF NOT EXISTS idx_admin_approval_steps_approver_due
ON admin_approval_steps (approver_id, due_at);

CREATE TABLE IF NOT EXISTS admin_approval_events (
    event_id BIGSERIAL PRIMARY KEY,
    approval_id TEXT NOT NULL REFERENCES admin_approvals(approval_id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    operator_id TEXT,
    operator_role TEXT,
    from_status TEXT,
    to_status TEXT,
    comment TEXT,
    request_id TEXT,
    trace_id TEXT,
    detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_approval_events_approval_created_at
ON admin_approval_events (approval_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_admin_approval_events_event_type_created_at
ON admin_approval_events (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_execution_jobs (
    job_id TEXT PRIMARY KEY,
    approval_id TEXT NOT NULL REFERENCES admin_approvals(approval_id) ON DELETE CASCADE,
    execution_type TEXT NOT NULL,
    target_system TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    idempotency_key TEXT NOT NULL,
    handler_name TEXT,
    request_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_code TEXT,
    error_message TEXT,
    queued_by TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retry_count INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    CHECK (retry_count >= 0),
    CHECK (max_retry_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_execution_jobs_idempotency_key
ON admin_execution_jobs (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_admin_execution_jobs_approval
ON admin_execution_jobs (approval_id);

CREATE INDEX IF NOT EXISTS idx_admin_execution_jobs_status_created_at
ON admin_execution_jobs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_execution_attempts (
    attempt_id BIGSERIAL PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES admin_execution_jobs(job_id) ON DELETE CASCADE,
    attempt_no INTEGER NOT NULL,
    status TEXT NOT NULL,
    request_id TEXT,
    trace_id TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    error_code TEXT,
    error_summary TEXT,
    response_digest TEXT,
    CHECK (attempt_no > 0),
    CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_execution_attempts_job_attempt
ON admin_execution_attempts (job_id, attempt_no);

CREATE INDEX IF NOT EXISTS idx_admin_execution_attempts_job_started_at
ON admin_execution_attempts (job_id, started_at ASC);

CREATE TABLE IF NOT EXISTS admin_action_audit (
    audit_id BIGSERIAL PRIMARY KEY,
    action_type TEXT NOT NULL,
    operator_id TEXT,
    operator_email TEXT,
    operator_role TEXT,
    session_id TEXT,
    approval_id TEXT,
    job_id TEXT,
    request_id TEXT,
    trace_id TEXT,
    resource_type TEXT,
    resource_id TEXT,
    result_status TEXT NOT NULL,
    error_code TEXT,
    client_ip TEXT,
    user_agent TEXT,
    before_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    after_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (result_status IN ('success', 'failure', 'denied'))
);

CREATE INDEX IF NOT EXISTS idx_admin_action_audit_operator_created_at
ON admin_action_audit (operator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_action_audit_approval_created_at
ON admin_action_audit (approval_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_action_audit_request_id
ON admin_action_audit (request_id);

CREATE INDEX IF NOT EXISTS idx_admin_action_audit_resource_created_at
ON admin_action_audit (resource_type, resource_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_action_audit_action_created_at
ON admin_action_audit (action_type, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_exports (
    export_id TEXT PRIMARY KEY,
    operator_id TEXT,
    export_scope TEXT NOT NULL,
    filters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    row_count INTEGER NOT NULL DEFAULT 0,
    contains_sensitive_data BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'queued',
    file_ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    CHECK (row_count >= 0),
    CHECK (status IN ('queued', 'completed', 'failed', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_exports_operator_created_at
ON admin_audit_exports (operator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_exports_status_created_at
ON admin_audit_exports (status, created_at DESC);