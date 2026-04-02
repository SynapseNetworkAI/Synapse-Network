from datetime import datetime, timezone
from decimal import Decimal

from src.domain import AdminApproval, AdminExecutionJob
from src.domain.enums import ApprovalLevel, ApprovalStatus, ExecutionAttemptStatus, ExecutionJobStatus, RiskLevel
from src.services.adapters import GatewayExecutionError, InMemoryGatewayExecutionAdapter
from src.services.auth.service import AdminIdentity
from src.services.execution.service import ExecutionService
from src.storage import InMemoryAdminStore


class FailingGatewayExecutionAdapter:
    def execute_job(self, job, operator):
        _ = job
        _ = operator
        raise GatewayExecutionError(
            code="TX_NOT_CONFIRMED",
            message="Transaction is not confirmed yet.",
            retriable=True,
            result_payload={"statusCode": 409},
        )


def _operator() -> AdminIdentity:
    return AdminIdentity(
        admin_id="adm_finance_reviewer",
        email="finance-review@synapse.network",
        display_name="Finance Reviewer",
        role="finance_reviewer",
        permissions=("execution:retry", "execution:read"),
    )


def test_retry_job_executes_gateway_command_and_marks_success() -> None:
    store = InMemoryAdminStore.seed_demo()
    service = ExecutionService(store, InMemoryGatewayExecutionAdapter())

    result = service.retry_job("job_apr_3", _operator())

    assert result["status"] == "SUCCEEDED"
    job = store.approval.get_execution_job("job_apr_3")
    approval = store.approval.get_approval("APR-20260316-003")
    attempts = store.approval.list_execution_attempts("job_apr_3")
    assert job is not None and job.status == ExecutionJobStatus.SUCCEEDED
    assert approval is not None and approval.status == ApprovalStatus.EXECUTED
    assert attempts[0].status == ExecutionAttemptStatus.SUCCEEDED
    assert attempts[0].attempt_no == 2


def test_retry_job_records_gateway_failure_and_keeps_job_failed() -> None:
    store = InMemoryAdminStore.seed_demo()
    service = ExecutionService(store, FailingGatewayExecutionAdapter())

    result = service.retry_job("job_apr_3", _operator())

    assert result["status"] == "FAILED"
    job = store.approval.get_execution_job("job_apr_3")
    approval = store.approval.get_approval("APR-20260316-003")
    attempts = store.approval.list_execution_attempts("job_apr_3")
    assert job is not None and job.status == ExecutionJobStatus.FAILED
    assert job.error_code == "TX_NOT_CONFIRMED"
    assert approval is not None and approval.status == ApprovalStatus.FAILED
    assert attempts[0].status == ExecutionAttemptStatus.FAILED
    assert attempts[0].error_code == "TX_NOT_CONFIRMED"


def test_retry_job_executes_refund_approval_command() -> None:
    store = InMemoryAdminStore.seed_demo()
    now = datetime.now(timezone.utc)
    store.approval.update_approval(
        AdminApproval(
            approval_id="APR-TEST-REFUND",
            approval_type="refund_approve",
            approval_level=ApprovalLevel.L2,
            status=ApprovalStatus.FAILED,
            requester_id="adm_finance_admin",
            resource_type="refund_intent",
            resource_id="ref_test_1",
            owner_address="0xownerrefund",
            tx_hash="0x" + "4" * 64,
            risk_level=RiskLevel.YELLOW,
            amount_usdc=Decimal("12.00"),
            reason="manual refund approval",
            payload={"txHash": "0x" + "4" * 64},
            created_at=now,
            updated_at=now,
        )
    )
    store.approval.update_execution_job(
        AdminExecutionJob(
            job_id="job_refund_test",
            approval_id="APR-TEST-REFUND",
            execution_type="refund_approve",
            target_system="gateway",
            idempotency_key="approval:APR-TEST-REFUND",
            status=ExecutionJobStatus.FAILED,
            retry_count=0,
            created_at=now,
            updated_at=now,
        )
    )

    service = ExecutionService(store, InMemoryGatewayExecutionAdapter())
    result = service.retry_job("job_refund_test", _operator())

    assert result["status"] == "SUCCEEDED"
    job = store.approval.get_execution_job("job_refund_test")
    assert job is not None
    assert job.result_payload.get("command") == "refund_complete"


def test_retry_job_executes_withdrawal_approval_command() -> None:
    store = InMemoryAdminStore.seed_demo()
    now = datetime.now(timezone.utc)
    store.approval.update_approval(
        AdminApproval(
            approval_id="APR-TEST-WITHDRAW",
            approval_type="withdrawal_approve",
            approval_level=ApprovalLevel.L2,
            status=ApprovalStatus.FAILED,
            requester_id="adm_finance_admin",
            resource_type="withdrawal_intent",
            resource_id="wd_test_1",
            owner_address="0xproviderwithdraw",
            tx_hash="0x" + "5" * 64,
            risk_level=RiskLevel.YELLOW,
            amount_usdc=Decimal("18.00"),
            reason="manual withdrawal approval",
            payload={"txHash": "0x" + "5" * 64},
            created_at=now,
            updated_at=now,
        )
    )
    store.approval.update_execution_job(
        AdminExecutionJob(
            job_id="job_withdraw_test",
            approval_id="APR-TEST-WITHDRAW",
            execution_type="withdrawal_approve",
            target_system="gateway",
            idempotency_key="approval:APR-TEST-WITHDRAW",
            status=ExecutionJobStatus.FAILED,
            retry_count=0,
            created_at=now,
            updated_at=now,
        )
    )

    service = ExecutionService(store, InMemoryGatewayExecutionAdapter())
    result = service.retry_job("job_withdraw_test", _operator())

    assert result["status"] == "SUCCEEDED"
    job = store.approval.get_execution_job("job_withdraw_test")
    assert job is not None
    assert job.result_payload.get("command") == "withdrawal_complete"