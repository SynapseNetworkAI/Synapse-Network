import asyncio
from datetime import datetime, timezone
from decimal import Decimal

from src.domain import AdminApproval, AdminExecutionJob
from src.domain.enums import ApprovalLevel, ApprovalStatus, ExecutionJobStatus, RiskLevel
from src.services.adapters import InMemoryGatewayExecutionAdapter, InMemoryProviderWithdrawReviewAdapter
from src.services.approval.service import ApprovalService
from src.services.auth.service import AdminIdentity
from src.services.execution.service import ExecutionService
from src.services.execution.worker import ExecutionWorker
from src.storage.analytics.provider_withdraw_review import InMemoryProviderWithdrawReviewRepository
from src.storage import InMemoryAdminStore


def test_execute_pending_jobs_once_consumes_pending_job() -> None:
    store = InMemoryAdminStore.seed_demo()
    now = datetime.now(timezone.utc)
    store.approval.update_approval(
        AdminApproval(
            approval_id="APR-TEST-PENDING-DEPOSIT",
            approval_type="deposit_repair",
            approval_level=ApprovalLevel.L2,
            status=ApprovalStatus.APPROVED_PENDING_EXECUTION,
            requester_id="adm_platform_ops_admin",
            resource_type="deposit_intent",
            resource_id="dep_pending_1",
            owner_address="0xownerpending",
            tx_hash="0x" + "6" * 64,
            risk_level=RiskLevel.YELLOW,
            amount_usdc=Decimal("23.00"),
            reason="auto execute pending deposit repair",
            payload={"txHash": "0x" + "6" * 64},
            created_at=now,
            updated_at=now,
        )
    )
    store.approval.update_execution_job(
        AdminExecutionJob(
            job_id="job_pending_deposit_test",
            approval_id="APR-TEST-PENDING-DEPOSIT",
            execution_type="deposit_repair",
            target_system="gateway",
            idempotency_key="approval:APR-TEST-PENDING-DEPOSIT",
            status=ExecutionJobStatus.PENDING,
            queued_by="adm_platform_ops_admin",
            retry_count=0,
            created_at=now,
            updated_at=now,
        )
    )

    service = ExecutionService(store, InMemoryGatewayExecutionAdapter())
    result = service.execute_pending_jobs_once(limit=10)

    assert result["processed"] >= 1
    job = store.approval.get_execution_job("job_pending_deposit_test")
    approval = store.approval.get_approval("APR-TEST-PENDING-DEPOSIT")
    assert job is not None and job.status == ExecutionJobStatus.SUCCEEDED
    assert approval is not None and approval.status == ApprovalStatus.EXECUTED


def test_execute_pending_jobs_once_claims_each_job_only_once() -> None:
    store = InMemoryAdminStore.seed_demo()
    now = datetime.now(timezone.utc)
    store.approval.update_approval(
        AdminApproval(
            approval_id="APR-TEST-PENDING-CLAIM",
            approval_type="deposit_repair",
            approval_level=ApprovalLevel.L2,
            status=ApprovalStatus.APPROVED_PENDING_EXECUTION,
            requester_id="adm_platform_ops_admin",
            resource_type="deposit_intent",
            resource_id="dep_pending_claim",
            owner_address="0xownerclaim",
            tx_hash="0x" + "7" * 64,
            risk_level=RiskLevel.YELLOW,
            amount_usdc=Decimal("11.00"),
            reason="claim safety",
            payload={"txHash": "0x" + "7" * 64},
            created_at=now,
            updated_at=now,
        )
    )
    store.approval.update_execution_job(
        AdminExecutionJob(
            job_id="job_pending_claim_test",
            approval_id="APR-TEST-PENDING-CLAIM",
            execution_type="deposit_repair",
            target_system="gateway",
            idempotency_key="approval:APR-TEST-PENDING-CLAIM",
            status=ExecutionJobStatus.PENDING,
            queued_by="adm_platform_ops_admin",
            retry_count=0,
            created_at=now,
            updated_at=now,
        )
    )

    service = ExecutionService(store, InMemoryGatewayExecutionAdapter())
    first = service.execute_pending_jobs_once(limit=10)
    second = service.execute_pending_jobs_once(limit=10)

    assert first["processed"] >= 1
    assert second["processed"] == 0


def test_worker_run_executes_pending_job_from_approval_pipeline() -> None:
    store = InMemoryAdminStore.seed_demo()
    provider_review_repository = InMemoryProviderWithdrawReviewRepository.seed_demo()
    approval_service = ApprovalService(
        store,
        provider_review_repository,
        InMemoryProviderWithdrawReviewAdapter(provider_review_repository),
    )
    execution_service = ExecutionService(store, InMemoryGatewayExecutionAdapter())
    worker = ExecutionWorker(execution_service, poll_interval_sec=0.05, batch_size=10)

    requester = AdminIdentity(
        admin_id="adm_finance_admin",
        email="finance@synapse.network",
        display_name="Finance Admin",
        role="finance_admin",
        permissions=("approval:submit", "approval:read"),
    )
    reviewer = AdminIdentity(
        admin_id="adm_finance_reviewer",
        email="finance-review@synapse.network",
        display_name="Finance Reviewer",
        role="finance_reviewer",
        permissions=("approval:decide", "execution:read", "execution:retry"),
    )

    created = approval_service.create_item(
        {
            "approvalType": "deposit_repair",
            "resourceType": "deposit_intent",
            "resourceId": "dep_worker_pipeline_001",
            "approvalLevel": "L2",
            "amountUsdc": "42.00",
            "reason": "pipeline e2e",
            "payload": {
                "txHash": "0x" + "8" * 64,
                "ownerAddress": "0xownerworkerpipeline",
                "eventKey": "evt_worker_pipeline_001",
            },
        },
        requester,
    )
    approval_id = created["approvalId"]

    decision = approval_service.decide(
        approval_id=approval_id,
        decision="APPROVE",
        reviewer=reviewer,
        comment="approve worker pipeline",
    )
    assert decision["status"] == "APPROVED_PENDING_EXECUTION"

    async def _run_worker_once() -> None:
        stop_event = asyncio.Event()
        task = asyncio.create_task(worker.run(stop_event))
        await asyncio.sleep(0.15)
        stop_event.set()
        await task

    asyncio.run(_run_worker_once())

    jobs = store.approval.list_execution_jobs(approval_id=approval_id, limit=10)
    approval = store.approval.get_approval(approval_id)
    attempts = store.approval.list_execution_attempts(jobs[0].job_id)

    assert jobs[0].status == ExecutionJobStatus.SUCCEEDED
    assert approval is not None and approval.status == ApprovalStatus.EXECUTED
    assert attempts[0].status.name == "SUCCEEDED"