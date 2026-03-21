\if :{?synapse_admin_db}
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

CREATE TABLE IF NOT EXISTS admin_mfa_enrollment_challenges (
    challenge_id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admin_users(admin_id) ON DELETE CASCADE,
    challenge_token_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'issued',
    factor_id TEXT REFERENCES admin_mfa_factors(factor_id) ON DELETE SET NULL,
    client_ip TEXT,
    user_agent TEXT,
    request_id TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('issued', 'verified', 'expired', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_mfa_enrollment_challenges_token_hash
ON admin_mfa_enrollment_challenges (challenge_token_hash);

CREATE INDEX IF NOT EXISTS idx_admin_mfa_enrollment_challenges_admin_status
ON admin_mfa_enrollment_challenges (admin_id, status, expires_at DESC);

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

INSERT INTO admin_roles (role_key, role_name, description, is_system, status)
VALUES
    ('super_admin', 'Super Admin', 'Platform emergency super admin', TRUE, 'active'),
    ('platform_ops_admin', 'Platform Ops Admin', 'Platform operations administrator', TRUE, 'active'),
    ('finance_admin', 'Finance Admin', 'Finance operator who can submit finance approvals', TRUE, 'active'),
    ('finance_reviewer', 'Finance Reviewer', 'Finance reviewer who can decide finance approvals', TRUE, 'active'),
    ('risk_admin', 'Risk Admin', 'Risk operator who can submit risk approvals', TRUE, 'active'),
    ('risk_reviewer', 'Risk Reviewer', 'Risk reviewer who can decide finance approvals', TRUE, 'active'),
    ('compliance_auditor', 'Compliance Auditor', 'Read-only compliance and audit reviewer', TRUE, 'active'),
    ('readonly_analyst', 'Readonly Analyst', 'Read-only metrics analyst', TRUE, 'active')
ON CONFLICT (role_key) DO UPDATE
SET role_name = EXCLUDED.role_name,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system,
    status = EXCLUDED.status,
    updated_at = NOW();

INSERT INTO admin_permissions (permission_key, resource_domain, action, risk_level, description)
VALUES
    ('dashboard:read', 'dashboard', 'read', 'low', 'Read admin dashboard overview and system status'),
    ('approval:read', 'approval', 'read', 'medium', 'Read approval queue and approval details'),
    ('approval:submit', 'approval', 'submit', 'high', 'Submit approval requests'),
    ('approval:decide', 'approval', 'decide', 'critical', 'Approve or reject approval requests'),
    ('audit:read', 'audit', 'read', 'high', 'Read admin audit records'),
    ('execution:read', 'execution', 'read', 'medium', 'Read execution queue and execution attempt details'),
    ('execution:retry', 'execution', 'retry', 'high', 'Retry failed execution jobs')
ON CONFLICT (permission_key) DO UPDATE
SET resource_domain = EXCLUDED.resource_domain,
    action = EXCLUDED.action,
    risk_level = EXCLUDED.risk_level,
    description = EXCLUDED.description;

INSERT INTO admin_role_permissions (role_key, permission_key, created_by)
VALUES
    ('super_admin', 'dashboard:read', 'system_seed'),
    ('super_admin', 'approval:read', 'system_seed'),
    ('super_admin', 'approval:submit', 'system_seed'),
    ('super_admin', 'approval:decide', 'system_seed'),
    ('super_admin', 'audit:read', 'system_seed'),
    ('super_admin', 'execution:read', 'system_seed'),
    ('super_admin', 'execution:retry', 'system_seed'),
    ('platform_ops_admin', 'dashboard:read', 'system_seed'),
    ('platform_ops_admin', 'approval:read', 'system_seed'),
    ('platform_ops_admin', 'execution:read', 'system_seed'),
    ('platform_ops_admin', 'execution:retry', 'system_seed'),
    ('finance_admin', 'dashboard:read', 'system_seed'),
    ('finance_admin', 'approval:read', 'system_seed'),
    ('finance_admin', 'approval:submit', 'system_seed'),
    ('finance_reviewer', 'dashboard:read', 'system_seed'),
    ('finance_reviewer', 'approval:read', 'system_seed'),
    ('finance_reviewer', 'approval:decide', 'system_seed'),
    ('finance_reviewer', 'execution:read', 'system_seed'),
    ('finance_reviewer', 'execution:retry', 'system_seed'),
    ('risk_admin', 'dashboard:read', 'system_seed'),
    ('risk_admin', 'approval:read', 'system_seed'),
    ('risk_admin', 'approval:submit', 'system_seed'),
    ('risk_reviewer', 'dashboard:read', 'system_seed'),
    ('risk_reviewer', 'approval:read', 'system_seed'),
    ('risk_reviewer', 'approval:decide', 'system_seed'),
    ('risk_reviewer', 'execution:read', 'system_seed'),
    ('risk_reviewer', 'execution:retry', 'system_seed'),
    ('compliance_auditor', 'dashboard:read', 'system_seed'),
    ('compliance_auditor', 'approval:read', 'system_seed'),
    ('compliance_auditor', 'audit:read', 'system_seed'),
    ('readonly_analyst', 'dashboard:read', 'system_seed')
ON CONFLICT (role_key, permission_key) DO NOTHING;

INSERT INTO admin_users (
    admin_id,
    email,
    display_name,
    status,
    auth_source,
    password_hash,
    require_mfa,
    created_at,
    updated_at
)
VALUES
    ('adm_super_admin', 'super@synapse.network', 'Super Admin', 'active', 'bootstrap', NULL, TRUE, NOW(), NOW()),
    ('adm_platform_ops_admin', 'ops@synapse.network', 'Platform Ops Admin', 'active', 'bootstrap', NULL, TRUE, NOW(), NOW()),
    ('adm_finance_admin', 'finance@synapse.network', 'Finance Admin', 'active', 'bootstrap', NULL, TRUE, NOW(), NOW()),
    ('adm_finance_reviewer', 'finance-review@synapse.network', 'Finance Reviewer', 'active', 'bootstrap', NULL, TRUE, NOW(), NOW()),
    ('adm_risk_admin', 'risk@synapse.network', 'Risk Admin', 'active', 'bootstrap', NULL, TRUE, NOW(), NOW()),
    ('adm_risk_reviewer', 'risk-review@synapse.network', 'Risk Reviewer', 'active', 'bootstrap', NULL, TRUE, NOW(), NOW()),
    ('adm_compliance_auditor', 'audit@synapse.network', 'Compliance Auditor', 'active', 'bootstrap', NULL, TRUE, NOW(), NOW()),
    ('adm_readonly_analyst', 'readonly@synapse.network', 'Readonly Analyst', 'active', 'bootstrap', NULL, TRUE, NOW(), NOW())
ON CONFLICT (admin_id) DO UPDATE
SET email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    status = EXCLUDED.status,
    auth_source = EXCLUDED.auth_source,
    require_mfa = EXCLUDED.require_mfa,
    updated_at = NOW();

INSERT INTO admin_mfa_factors (
    factor_id,
    admin_id,
    factor_type,
    factor_label,
    status,
    secret_ref,
    payload_json,
    created_at,
    updated_at
)
VALUES
    ('mfa_super_admin_totp', 'adm_super_admin', 'totp', 'bootstrap_totp', 'active', 'kms://admin/super/totp', '{"totpSecret": "JBSWY3DPEHPK3PXP"}'::jsonb, NOW(), NOW()),
    ('mfa_platform_ops_admin_totp', 'adm_platform_ops_admin', 'totp', 'bootstrap_totp', 'active', 'kms://admin/ops/totp', '{"totpSecret": "JBSWY3DPEHPK3PXP"}'::jsonb, NOW(), NOW()),
    ('mfa_finance_admin_totp', 'adm_finance_admin', 'totp', 'bootstrap_totp', 'active', 'kms://admin/finance/totp', '{"totpSecret": "JBSWY3DPEHPK3PXP"}'::jsonb, NOW(), NOW()),
    ('mfa_finance_reviewer_totp', 'adm_finance_reviewer', 'totp', 'bootstrap_totp', 'active', 'kms://admin/finance-review/totp', '{"totpSecret": "JBSWY3DPEHPK3PXP"}'::jsonb, NOW(), NOW()),
    ('mfa_risk_admin_totp', 'adm_risk_admin', 'totp', 'bootstrap_totp', 'active', 'kms://admin/risk/totp', '{"totpSecret": "JBSWY3DPEHPK3PXP"}'::jsonb, NOW(), NOW()),
    ('mfa_risk_reviewer_totp', 'adm_risk_reviewer', 'totp', 'bootstrap_totp', 'active', 'kms://admin/risk-review/totp', '{"totpSecret": "JBSWY3DPEHPK3PXP"}'::jsonb, NOW(), NOW()),
    ('mfa_compliance_auditor_totp', 'adm_compliance_auditor', 'totp', 'bootstrap_totp', 'active', 'kms://admin/audit/totp', '{"totpSecret": "JBSWY3DPEHPK3PXP"}'::jsonb, NOW(), NOW()),
    ('mfa_readonly_analyst_totp', 'adm_readonly_analyst', 'totp', 'bootstrap_totp', 'active', 'kms://admin/readonly/totp', '{"totpSecret": "JBSWY3DPEHPK3PXP"}'::jsonb, NOW(), NOW())
ON CONFLICT (factor_id) DO UPDATE
SET status = EXCLUDED.status,
    secret_ref = EXCLUDED.secret_ref,
    payload_json = EXCLUDED.payload_json,
    updated_at = NOW();

INSERT INTO admin_user_role_bindings (
    binding_id,
    admin_id,
    role_key,
    scope_json,
    status,
    granted_by,
    grant_reason,
    starts_at,
    created_at,
    updated_at
)
VALUES
    ('bind_super_admin', 'adm_super_admin', 'super_admin', '{}'::jsonb, 'active', 'system_seed', 'bootstrap role assignment', NOW(), NOW(), NOW()),
    ('bind_platform_ops_admin', 'adm_platform_ops_admin', 'platform_ops_admin', '{}'::jsonb, 'active', 'system_seed', 'bootstrap role assignment', NOW(), NOW(), NOW()),
    ('bind_finance_admin', 'adm_finance_admin', 'finance_admin', '{}'::jsonb, 'active', 'system_seed', 'bootstrap role assignment', NOW(), NOW(), NOW()),
    ('bind_finance_reviewer', 'adm_finance_reviewer', 'finance_reviewer', '{}'::jsonb, 'active', 'system_seed', 'bootstrap role assignment', NOW(), NOW(), NOW()),
    ('bind_risk_admin', 'adm_risk_admin', 'risk_admin', '{}'::jsonb, 'active', 'system_seed', 'bootstrap role assignment', NOW(), NOW(), NOW()),
    ('bind_risk_reviewer', 'adm_risk_reviewer', 'risk_reviewer', '{}'::jsonb, 'active', 'system_seed', 'bootstrap role assignment', NOW(), NOW(), NOW()),
    ('bind_compliance_auditor', 'adm_compliance_auditor', 'compliance_auditor', '{}'::jsonb, 'active', 'system_seed', 'bootstrap role assignment', NOW(), NOW(), NOW()),
    ('bind_readonly_analyst', 'adm_readonly_analyst', 'readonly_analyst', '{}'::jsonb, 'active', 'system_seed', 'bootstrap role assignment', NOW(), NOW(), NOW())
ON CONFLICT (binding_id) DO UPDATE
SET role_key = EXCLUDED.role_key,
    scope_json = EXCLUDED.scope_json,
    status = EXCLUDED.status,
    granted_by = EXCLUDED.granted_by,
    grant_reason = EXCLUDED.grant_reason,
    starts_at = EXCLUDED.starts_at,
    updated_at = NOW();

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
\endif

\if :{?synapse_gateway_db}
CREATE OR REPLACE VIEW synapse_admin_dashboard_finance_projection AS
WITH day_window AS (
    SELECT date_trunc('day', NOW()) AS day_start
),
reconciliation AS (
    SELECT
        COALESCE(NULLIF(payload->>'deltaUsdc', '')::numeric, 0) AS vault_ledger_delta_usdc,
        updated_at AS reconciliation_updated_at
    FROM synapse_runtime_state
    WHERE state_key = 'deposit_reconciliation_state'
),
balance_snapshot AS (
    SELECT
        COALESCE(SUM(ab.available_balance + ab.pending_balance) FILTER (WHERE la.account_kind = 'consumer_wallet'), 0) AS consumer_liability_usdc,
        COALESCE(SUM(ab.available_balance + ab.pending_balance) FILTER (WHERE la.account_kind = 'provider_wallet'), 0) AS provider_payable_usdc,
        COALESCE(SUM(ab.available_balance + ab.pending_balance) FILTER (WHERE la.account_kind = 'platform_revenue'), 0) AS platform_fee_balance_usdc,
        MAX(ab.updated_at) AS balances_updated_at
    FROM synapse_account_balances AS ab
    JOIN synapse_ledger_accounts AS la ON la.account_id = ab.account_id
),
deposit_window AS (
    SELECT
        COALESCE(SUM(amount_usdc) FILTER (
            WHERE created_at >= (SELECT day_start FROM day_window)
                AND upper(status) <> 'FAILED'
        ), 0) AS today_deposit_usdc,
        COUNT(*) FILTER (
            WHERE upper(status) = 'PENDING_CONFIRMATION'
        )::bigint AS pending_deposit_count,
        MAX(updated_at) AS deposits_updated_at
    FROM synapse_vault_deposits
),
consumer_refund_window AS (
    SELECT
        COALESCE(SUM(amount_usdc) FILTER (
            WHERE updated_at >= (SELECT day_start FROM day_window)
                AND upper(status) = 'CONFIRMED'
                AND withdrawal_kind = 'consumer_refund'
        ), 0) AS today_consumer_refund_usdc,
        COUNT(*) FILTER (
            WHERE upper(status) IN ('REQUESTED', 'SIGNED', 'BROADCASTED')
                AND withdrawal_kind = 'consumer_refund'
        )::bigint AS pending_consumer_refund_count,
        MAX(updated_at) AS consumer_refunds_updated_at
    FROM synapse_vault_withdrawals
),
provider_withdrawal_window AS (
    SELECT
        COALESCE(SUM(amount_usdc) FILTER (
            WHERE updated_at >= (SELECT day_start FROM day_window)
                AND upper(status) = 'CONFIRMED'
                AND withdrawal_kind = 'provider_withdrawal'
        ), 0) AS today_provider_withdrawal_usdc,
        COUNT(*) FILTER (
            WHERE upper(status) IN ('REQUESTED', 'SIGNED', 'BROADCASTED')
                AND withdrawal_kind = 'provider_withdrawal'
        )::bigint AS pending_provider_withdrawal_count,
        MAX(updated_at) AS provider_withdrawals_updated_at
    FROM synapse_vault_withdrawals
),
charge_window AS (
    SELECT
        COALESCE(SUM(charged_usdc) FILTER (
            WHERE created_at >= (SELECT day_start FROM day_window)
                AND status IN ('SUCCEEDED', 'SETTLED')
        ), 0) AS today_charge_usdc,
        MAX(updated_at) AS charge_updated_at
    FROM synapse_invocations
)
SELECT
    charge_window.today_charge_usdc::numeric(36, 6) AS today_charge_usdc,
    deposit_window.today_deposit_usdc::numeric(36, 6) AS today_deposit_usdc,
    consumer_refund_window.today_consumer_refund_usdc::numeric(36, 6) AS today_consumer_refund_usdc,
    provider_withdrawal_window.today_provider_withdrawal_usdc::numeric(36, 6) AS today_provider_withdrawal_usdc,
    balance_snapshot.consumer_liability_usdc::numeric(36, 6) AS consumer_liability_usdc,
    balance_snapshot.provider_payable_usdc::numeric(36, 6) AS provider_payable_usdc,
    balance_snapshot.platform_fee_balance_usdc::numeric(36, 6) AS platform_fee_balance_usdc,
    COALESCE(reconciliation.vault_ledger_delta_usdc, 0)::numeric(36, 6) AS vault_ledger_delta_usdc,
    deposit_window.pending_deposit_count,
    consumer_refund_window.pending_consumer_refund_count,
    provider_withdrawal_window.pending_provider_withdrawal_count,
    GREATEST(
        COALESCE(balance_snapshot.balances_updated_at, 'epoch'::timestamptz),
        COALESCE(deposit_window.deposits_updated_at, 'epoch'::timestamptz),
        COALESCE(consumer_refund_window.consumer_refunds_updated_at, 'epoch'::timestamptz),
        COALESCE(provider_withdrawal_window.provider_withdrawals_updated_at, 'epoch'::timestamptz),
        COALESCE(charge_window.charge_updated_at, 'epoch'::timestamptz),
        COALESCE(reconciliation.reconciliation_updated_at, 'epoch'::timestamptz)
    ) AS projected_at
FROM balance_snapshot
CROSS JOIN deposit_window
CROSS JOIN consumer_refund_window
CROSS JOIN provider_withdrawal_window
CROSS JOIN charge_window
LEFT JOIN reconciliation ON TRUE;

CREATE OR REPLACE VIEW synapse_admin_dashboard_activity_trend_projection AS
WITH day_series AS (
    SELECT generate_series(
        date_trunc('day', NOW()) - INTERVAL '6 day',
        date_trunc('day', NOW()),
        INTERVAL '1 day'
    )::date AS bucket_date
),
deposit_daily AS (
    SELECT
        created_at::date AS bucket_date,
        COALESCE(SUM(amount_usdc), 0) AS deposit_usdc
    FROM synapse_vault_deposits
    WHERE upper(status) <> 'FAILED'
    GROUP BY created_at::date
),
charge_daily AS (
    SELECT
        created_at::date AS bucket_date,
        COALESCE(SUM(charged_usdc), 0) AS charge_usdc
    FROM synapse_invocations
    WHERE status IN ('SUCCEEDED', 'SETTLED')
    GROUP BY created_at::date
),
consumer_refund_daily AS (
    SELECT
        updated_at::date AS bucket_date,
        COALESCE(SUM(amount_usdc), 0) AS consumer_refund_usdc
    FROM synapse_vault_withdrawals
    WHERE upper(status) = 'CONFIRMED'
        AND withdrawal_kind = 'consumer_refund'
    GROUP BY updated_at::date
),
provider_withdrawal_daily AS (
    SELECT
        updated_at::date AS bucket_date,
        COALESCE(SUM(amount_usdc), 0) AS provider_withdrawal_usdc
    FROM synapse_vault_withdrawals
    WHERE upper(status) = 'CONFIRMED'
        AND withdrawal_kind = 'provider_withdrawal'
    GROUP BY updated_at::date
)
SELECT
    day_series.bucket_date,
    COALESCE(deposit_daily.deposit_usdc, 0)::numeric(36, 6) AS deposit_usdc,
    COALESCE(charge_daily.charge_usdc, 0)::numeric(36, 6) AS charge_usdc,
    COALESCE(consumer_refund_daily.consumer_refund_usdc, 0)::numeric(36, 6) AS consumer_refund_usdc,
    COALESCE(provider_withdrawal_daily.provider_withdrawal_usdc, 0)::numeric(36, 6) AS provider_withdrawal_usdc,
    (
        COALESCE(deposit_daily.deposit_usdc, 0)
        - COALESCE(consumer_refund_daily.consumer_refund_usdc, 0)
        - COALESCE(provider_withdrawal_daily.provider_withdrawal_usdc, 0)
    )::numeric(36, 6) AS net_flow_usdc
FROM day_series
LEFT JOIN deposit_daily ON deposit_daily.bucket_date = day_series.bucket_date
LEFT JOIN charge_daily ON charge_daily.bucket_date = day_series.bucket_date
LEFT JOIN consumer_refund_daily ON consumer_refund_daily.bucket_date = day_series.bucket_date
LEFT JOIN provider_withdrawal_daily ON provider_withdrawal_daily.bucket_date = day_series.bucket_date
ORDER BY day_series.bucket_date ASC;

CREATE OR REPLACE VIEW synapse_admin_dashboard_operations_projection AS
WITH reconciliation AS (
    SELECT
        CASE
            WHEN NULLIF(payload->>'lastCheckAt', '') IS NOT NULL
                THEN to_timestamp((payload->>'lastCheckAt')::double precision)
            ELSE NULL
        END AS last_reconciliation_at,
        COALESCE(NULLIF(payload->>'deltaUsdc', '')::numeric, 0) AS reconciliation_delta_usdc,
        COALESCE(NULLIF(payload->>'alert', '')::boolean, FALSE) AS reconciliation_alert,
        NULLIF(payload->>'lastError', '') AS reconciliation_last_error,
        updated_at AS reconciliation_updated_at
    FROM synapse_runtime_state
    WHERE state_key = 'deposit_reconciliation_state'
),
runtime_projection AS (
    SELECT updated_at AS runtime_projection_updated_at
    FROM synapse_runtime_state
    WHERE state_key = 'agent_runtime_projection_state'
),
failed_deposits AS (
    SELECT
        COUNT(*)::bigint AS failed_deposit_count,
        MAX(updated_at) AS failed_deposits_updated_at
    FROM synapse_vault_deposits
    WHERE upper(status) = 'FAILED'
),
audit_window AS (
    SELECT
        COUNT(*) FILTER (
            WHERE lower(COALESCE(result_status, '')) IN ('failed', 'failure', 'alert', 'degraded')
                OR error_code IS NOT NULL
        )::bigint AS recent_audit_alerts,
        MAX(created_at) AS audit_updated_at
    FROM synapse_audit_events
    WHERE created_at >= NOW() - INTERVAL '24 hours'
),
system_window AS (
    SELECT
        COUNT(*) FILTER (
            WHERE lower(COALESCE(result_status, '')) IN ('failed', 'failure', 'error', 'degraded')
                OR error_code IS NOT NULL
        )::bigint AS recent_gateway_failures,
        MAX(created_at) AS system_updated_at
    FROM synapse_audit_events
    WHERE created_at >= NOW() - INTERVAL '30 minutes'
)
SELECT
    CASE
        WHEN COALESCE(reconciliation.reconciliation_alert, FALSE)
            OR COALESCE(system_window.recent_gateway_failures, 0) > 0
            OR reconciliation.reconciliation_last_error IS NOT NULL
        THEN 'degraded'
        ELSE 'healthy'
    END AS gateway_status,
    runtime_projection.runtime_projection_updated_at AS indexer_last_processed_at,
    runtime_projection.runtime_projection_updated_at AS backfill_last_scan_at,
    NULL::bigint AS backfill_last_scanned_block,
    COALESCE(system_window.recent_gateway_failures, 0) AS recent_gateway_failures,
    COALESCE(failed_deposits.failed_deposit_count, 0) AS failed_deposit_count,
    COALESCE(audit_window.recent_audit_alerts, 0) AS recent_audit_alerts,
    reconciliation.last_reconciliation_at,
    COALESCE(reconciliation.reconciliation_alert, FALSE) AS reconciliation_alert,
    COALESCE(reconciliation.reconciliation_delta_usdc, 0)::numeric(36, 6) AS reconciliation_delta_usdc,
    reconciliation.reconciliation_last_error,
    GREATEST(
        COALESCE(reconciliation.reconciliation_updated_at, 'epoch'::timestamptz),
        COALESCE(runtime_projection.runtime_projection_updated_at, 'epoch'::timestamptz),
        COALESCE(failed_deposits.failed_deposits_updated_at, 'epoch'::timestamptz),
        COALESCE(audit_window.audit_updated_at, 'epoch'::timestamptz),
        COALESCE(system_window.system_updated_at, 'epoch'::timestamptz)
    ) AS projected_at
FROM system_window
CROSS JOIN failed_deposits
CROSS JOIN audit_window
LEFT JOIN reconciliation ON TRUE
LEFT JOIN runtime_projection ON TRUE;

CREATE OR REPLACE VIEW synapse_admin_dashboard_projection AS
SELECT
    operations.failed_deposit_count AS deposit_exceptions,
    operations.recent_audit_alerts AS audit_alerts,
    finance.vault_ledger_delta_usdc,
    operations.gateway_status,
    operations.last_reconciliation_at,
    operations.reconciliation_alert,
    operations.reconciliation_last_error,
    GREATEST(finance.projected_at, operations.projected_at) AS projected_at
FROM synapse_admin_dashboard_finance_projection AS finance
CROSS JOIN synapse_admin_dashboard_operations_projection AS operations;

COMMENT ON VIEW synapse_admin_dashboard_finance_projection IS
'Stable admin finance snapshot derived from the target-state Owner / Agent / Provider runtime tables.';

COMMENT ON VIEW synapse_admin_dashboard_activity_trend_projection IS
'Stable admin daily activity trend projection derived from the target-state Owner / Agent / Provider runtime tables.';

COMMENT ON VIEW synapse_admin_dashboard_operations_projection IS
'Stable admin operations projection derived from runtime state and target-state audit events.';

COMMENT ON VIEW synapse_admin_dashboard_projection IS
'Target-state compatibility aggregation view built from the finance and operations projections.';
\endif
