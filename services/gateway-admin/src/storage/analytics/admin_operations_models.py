from dataclasses import dataclass
from decimal import Decimal


@dataclass(slots=True, frozen=True)
class Pagination:
    page: int
    page_size: int
    total: int
    total_pages: int


@dataclass(slots=True, frozen=True)
class OwnerAccountRecord:
    owner_id: str
    owner_wallet: str
    account_name: str | None
    email: str | None
    email_verified: bool
    pending_email: str | None
    status: str
    roles: tuple[str, ...]
    agent_count: int
    provider_service_count: int
    support_case_count: int
    created_at: str | None
    updated_at: str | None
    last_active_at: str | None


@dataclass(slots=True, frozen=True)
class OwnerBalanceSummary:
    consumer_available_usdc: Decimal
    consumer_frozen_usdc: Decimal
    provider_available_usdc: Decimal
    provider_frozen_usdc: Decimal


@dataclass(slots=True, frozen=True)
class OwnerAccountDetail:
    account: OwnerAccountRecord
    balances: OwnerBalanceSummary
    recent_deposits: tuple["ConsumerDepositRecord", ...]
    recent_provider_withdrawals: tuple["ProviderWithdrawalRecord", ...]
    recent_invocations: tuple[dict, ...]
    support_cases: tuple[dict, ...]


@dataclass(slots=True, frozen=True)
class OwnerAccountPage:
    items: tuple[OwnerAccountRecord, ...]
    pagination: Pagination


@dataclass(slots=True, frozen=True)
class ConsumerDepositRecord:
    deposit_id: str
    owner_id: str
    owner_wallet: str
    owner_email: str | None
    tx_hash: str
    amount_usdc: Decimal
    network: str | None
    status: str
    confirmations: int | None
    credited_at: str | None
    created_at: str | None
    updated_at: str | None


@dataclass(slots=True, frozen=True)
class ConsumerDepositDetail:
    deposit: ConsumerDepositRecord
    ledger_entries: tuple[dict, ...]
    audit_events: tuple[dict, ...]
    notification_events: tuple[dict, ...]


@dataclass(slots=True, frozen=True)
class ConsumerDepositPage:
    items: tuple[ConsumerDepositRecord, ...]
    pagination: Pagination


@dataclass(slots=True, frozen=True)
class ProviderWithdrawalRecord:
    withdrawal_id: str
    provider_id: str | None
    provider_name: str | None
    owner_id: str
    owner_wallet: str
    owner_email: str | None
    amount_usdc: Decimal
    fee_usdc: Decimal | None
    status: str
    tx_hash: str | None
    ticket_id: str | None
    request_id: str | None
    review_decision: str | None
    funds_state: str
    created_at: str | None
    updated_at: str | None


@dataclass(slots=True, frozen=True)
class ProviderWithdrawalDetail:
    withdrawal: ProviderWithdrawalRecord
    ledger_entries: tuple[dict, ...]
    audit_events: tuple[dict, ...]
    notification_events: tuple[dict, ...]
    review_history: tuple[dict, ...]


@dataclass(slots=True, frozen=True)
class ProviderWithdrawalPage:
    items: tuple[ProviderWithdrawalRecord, ...]
    pagination: Pagination
