from src.storage.base import AdminStore


class AuditService:
    def __init__(self, store: AdminStore) -> None:
        self._store = store

    def list_actions(
        self,
        action_type: str | None = None,
        result_status: str | None = None,
        operator_id: str | None = None,
        approval_id: str | None = None,
        job_id: str | None = None,
        limit: int = 50,
    ) -> dict:
        actions = self._store.audit.list_actions(
            action_type=action_type,
            result_status=result_status,
            operator_id=operator_id,
            approval_id=approval_id,
            job_id=job_id,
            limit=limit,
        )
        return {
            "items": [
                {
                    "auditId": action.audit_id,
                    "actionType": action.action_type,
                    "resultStatus": action.result_status.value,
                    "operatorId": action.operator_id,
                    "operatorEmail": action.operator_email,
                    "operatorRole": action.operator_role,
                    "approvalId": action.approval_id,
                    "jobId": action.job_id,
                    "resourceType": action.resource_type,
                    "resourceId": action.resource_id,
                    "errorCode": action.error_code,
                    "createdAt": action.created_at.isoformat().replace("+00:00", "Z") if action.created_at else None,
                }
                for action in actions
            ],
            "nextCursor": None,
        }