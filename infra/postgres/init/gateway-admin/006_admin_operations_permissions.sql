INSERT INTO admin_permissions (permission_key, resource_domain, action, risk_level, description)
VALUES
    ('owner:read', 'owner', 'read', 'medium', 'Read business owner accounts with masked PII'),
    ('owner:pii:read', 'owner', 'pii:read', 'high', 'Reveal full owner email addresses with audit trail'),
    ('finance:read', 'finance', 'read', 'high', 'Read finance deposits, withdrawals, ledger, and evidence'),
    ('finance:export', 'finance', 'export', 'critical', 'Export finance evidence and PII-bearing operational records')
ON CONFLICT (permission_key) DO UPDATE
SET resource_domain = EXCLUDED.resource_domain,
    action = EXCLUDED.action,
    risk_level = EXCLUDED.risk_level,
    description = EXCLUDED.description;

INSERT INTO admin_role_permissions (role_key, permission_key, created_by)
VALUES
    ('super_admin', 'owner:read', 'system_seed'),
    ('super_admin', 'owner:pii:read', 'system_seed'),
    ('super_admin', 'finance:read', 'system_seed'),
    ('super_admin', 'finance:export', 'system_seed'),
    ('platform_ops_admin', 'owner:read', 'system_seed'),
    ('platform_ops_admin', 'finance:read', 'system_seed'),
    ('finance_admin', 'owner:read', 'system_seed'),
    ('finance_admin', 'finance:read', 'system_seed'),
    ('finance_admin', 'finance:export', 'system_seed'),
    ('finance_reviewer', 'owner:read', 'system_seed'),
    ('finance_reviewer', 'finance:read', 'system_seed'),
    ('compliance_auditor', 'owner:read', 'system_seed'),
    ('compliance_auditor', 'finance:read', 'system_seed')
ON CONFLICT (role_key, permission_key) DO NOTHING;
