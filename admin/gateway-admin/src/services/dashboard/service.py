from src.services.adapters.gateway_client import GatewayAdapter
from src.services.approval.service import ApprovalService


class DashboardService:
    def __init__(self, gateway_adapter: GatewayAdapter, approval_service: ApprovalService) -> None:
        self._gateway_adapter = gateway_adapter
        self._approval_service = approval_service

    def get_overview(self) -> dict:
        overview = self._gateway_adapter.get_finance_overview()
        overview["pendingApprovals"] = self._approval_service.pending_count()
        return {
            "metrics": {
                "pendingApprovals": overview["pendingApprovals"],
                "depositExceptions": overview["depositExceptions"],
                "auditAlerts": overview["auditAlerts"],
                "vaultLedgerDelta": overview["vaultLedgerDelta"],
            },
            "highlights": overview["highlights"],
        }

    def get_system_status(self) -> dict:
        status = self._gateway_adapter.get_system_status()
        status["approvalQueueDepth"] = self._approval_service.pending_count()
        return status
