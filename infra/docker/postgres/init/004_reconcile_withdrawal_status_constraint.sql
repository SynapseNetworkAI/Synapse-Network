-- Reconcile withdrawal status rows and constraint after legacy runtime hotfix drift.
-- This script is safe to run manually against existing databases.

UPDATE synapse_vault_withdrawals
SET status = CASE status
    WHEN 'requested' THEN 'REQUESTED'
    WHEN 'signed' THEN 'SIGNED'
    WHEN 'failed' THEN 'FAILED'
    WHEN 'approved_auto' THEN 'APPROVED_AUTO'
    WHEN 'pending_manual_review' THEN 'PENDING_MANUAL_REVIEW'
    WHEN 'rejected' THEN 'REJECTED'
    WHEN 'completed' THEN 'COMPLETED'
    WHEN 'cancelled' THEN 'CANCELLED'
    ELSE status
END,
updated_at = NOW()
WHERE status IN (
    'requested',
    'signed',
    'failed',
    'approved_auto',
    'pending_manual_review',
    'rejected',
    'completed',
    'cancelled'
);

ALTER TABLE IF EXISTS synapse_vault_withdrawals
DROP CONSTRAINT IF EXISTS synapse_vault_withdrawals_status_check;

ALTER TABLE IF EXISTS synapse_vault_withdrawals
ADD CONSTRAINT synapse_vault_withdrawals_status_check
CHECK (
    status IN (
        'REQUESTED',
        'SIGNED',
        'FAILED',
        'APPROVED_AUTO',
        'PENDING_MANUAL_REVIEW',
        'REJECTED',
        'COMPLETED',
        'CANCELLED'
    )
) NOT VALID;

ALTER TABLE IF EXISTS synapse_vault_withdrawals
VALIDATE CONSTRAINT synapse_vault_withdrawals_status_check;