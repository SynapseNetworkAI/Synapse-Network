class GatewayAdapter:
    def get_system_status(self) -> dict:
        return {
            "gatewayAdmin": "healthy",
            "gateway": "healthy",
            "approvalQueueDepth": 12,
            "lastReconciliationAt": "2026-03-16T08:00:00Z",
        }

    def get_finance_overview(self) -> dict:
        return {
            "pendingApprovals": 12,
            "depositExceptions": 3,
            "auditAlerts": 1,
            "vaultLedgerDelta": "0.00",
            "highlights": [
                {
                    "title": "待处理充值异常",
                    "value": "3",
                    "trend": "requires_attention",
                }
            ],
        }
