ALTER TABLE provider_api_invocations
ADD COLUMN IF NOT EXISTS observability_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE provider_contract_audit_reports
ADD COLUMN IF NOT EXISTS observability_json JSONB NOT NULL DEFAULT '{}'::jsonb;
