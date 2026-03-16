-- Synapse Gateway Admin seed data
-- Built-in roles, permissions, role bindings, MFA placeholders and bootstrap admin users.

INSERT INTO admin_roles (role_key, role_name, description, is_system, status)
VALUES
    ('super_admin', 'Super Admin', 'Platform emergency super admin', TRUE, 'active'),
    ('platform_ops_admin', 'Platform Ops Admin', 'Platform operations administrator', TRUE, 'active'),
    ('finance_admin', 'Finance Admin', 'Finance operator who can submit finance approvals', TRUE, 'active'),
    ('finance_reviewer', 'Finance Reviewer', 'Finance reviewer who can decide finance approvals', TRUE, 'active'),
    ('risk_admin', 'Risk Admin', 'Risk operator who can submit risk approvals', TRUE, 'active'),
    ('risk_reviewer', 'Risk Reviewer', 'Risk reviewer who can decide risk approvals', TRUE, 'active'),
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
    ('audit:read', 'audit', 'read', 'high', 'Read admin audit records')
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
    ('platform_ops_admin', 'dashboard:read', 'system_seed'),
    ('platform_ops_admin', 'approval:read', 'system_seed'),
    ('finance_admin', 'dashboard:read', 'system_seed'),
    ('finance_admin', 'approval:read', 'system_seed'),
    ('finance_admin', 'approval:submit', 'system_seed'),
    ('finance_reviewer', 'dashboard:read', 'system_seed'),
    ('finance_reviewer', 'approval:read', 'system_seed'),
    ('finance_reviewer', 'approval:decide', 'system_seed'),
    ('risk_admin', 'dashboard:read', 'system_seed'),
    ('risk_admin', 'approval:read', 'system_seed'),
    ('risk_admin', 'approval:submit', 'system_seed'),
    ('risk_reviewer', 'dashboard:read', 'system_seed'),
    ('risk_reviewer', 'approval:read', 'system_seed'),
    ('risk_reviewer', 'approval:decide', 'system_seed'),
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
    ('mfa_super_admin_totp', 'adm_super_admin', 'totp', 'bootstrap_totp', 'active', 'kms://admin/super/totp', '{}'::jsonb, NOW(), NOW()),
    ('mfa_platform_ops_admin_totp', 'adm_platform_ops_admin', 'totp', 'bootstrap_totp', 'active', 'kms://admin/ops/totp', '{}'::jsonb, NOW(), NOW()),
    ('mfa_finance_admin_totp', 'adm_finance_admin', 'totp', 'bootstrap_totp', 'active', 'kms://admin/finance/totp', '{}'::jsonb, NOW(), NOW()),
    ('mfa_finance_reviewer_totp', 'adm_finance_reviewer', 'totp', 'bootstrap_totp', 'active', 'kms://admin/finance-review/totp', '{}'::jsonb, NOW(), NOW()),
    ('mfa_risk_admin_totp', 'adm_risk_admin', 'totp', 'bootstrap_totp', 'active', 'kms://admin/risk/totp', '{}'::jsonb, NOW(), NOW()),
    ('mfa_risk_reviewer_totp', 'adm_risk_reviewer', 'totp', 'bootstrap_totp', 'active', 'kms://admin/risk-review/totp', '{}'::jsonb, NOW(), NOW()),
    ('mfa_compliance_auditor_totp', 'adm_compliance_auditor', 'totp', 'bootstrap_totp', 'active', 'kms://admin/audit/totp', '{}'::jsonb, NOW(), NOW()),
    ('mfa_readonly_analyst_totp', 'adm_readonly_analyst', 'totp', 'bootstrap_totp', 'active', 'kms://admin/readonly/totp', '{}'::jsonb, NOW(), NOW())
ON CONFLICT (factor_id) DO UPDATE
SET status = EXCLUDED.status,
    secret_ref = EXCLUDED.secret_ref,
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