from pydantic import BaseModel, Field


class HighlightCard(BaseModel):
    title: str
    value: str
    trend: str


class OverviewMetrics(BaseModel):
    pending_approvals: int = Field(serialization_alias="pendingApprovals")
    deposit_exceptions: int = Field(serialization_alias="depositExceptions")
    audit_alerts: int = Field(serialization_alias="auditAlerts")
    vault_ledger_delta: str = Field(serialization_alias="vaultLedgerDelta")


class DashboardOverview(BaseModel):
    metrics: OverviewMetrics
    highlights: list[HighlightCard]


class SystemStatus(BaseModel):
    gateway_admin: str = Field(serialization_alias="gatewayAdmin")
    gateway: str
    approval_queue_depth: int = Field(serialization_alias="approvalQueueDepth")
    last_reconciliation_at: str = Field(serialization_alias="lastReconciliationAt")
