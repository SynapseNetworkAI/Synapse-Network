"""Shared constants for the owner finance service."""
import os

REFUND_MANUAL_REVIEW_THRESHOLD_USDC = 500.0
REFUND_AUTO_TYPE = "SYSTEM_FAILURE"
REFUND_MANUAL_TYPE = "MANUAL_APPEAL"
REFUND_ACTIVE_STATUSES = {"REQUESTED", "PENDING_MANUAL_REVIEW"}

# Consumer balance withdrawal constants — all three are configurable via env var.
CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC: float = float(
    os.getenv("CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC", "500.0")
)
CONSUMER_WITHDRAW_MIN_USDC: float = float(
    os.getenv("CONSUMER_WITHDRAW_MIN_USDC", "10.0")
)
CONSUMER_WITHDRAW_MATURITY_SECONDS: int = int(
    os.getenv("CONSUMER_WITHDRAW_MATURITY_SECONDS", "86400")
)
CONSUMER_WITHDRAW_MAX_DAILY_COUNT: int = int(
    os.getenv("CONSUMER_WITHDRAW_MAX_DAILY_COUNT", "3")
)
CONSUMER_WITHDRAW_TYPE = "CONSUMER_BALANCE_WITHDRAW"

# Withdrawal fee: flat amount in USDC deducted from the withdrawal gross.
# Net sent to user = amountUsdc − fee.  Fee accrues to platformFeePool on-chain.
CONSUMER_WITHDRAW_FEE_USDC: float = float(
    os.getenv("CONSUMER_WITHDRAW_FEE_USDC", "0.50")
)
# Auto-processor polling interval (seconds).
CONSUMER_WITHDRAW_PROCESSOR_INTERVAL_SEC: float = float(
    os.getenv("CONSUMER_WITHDRAW_PROCESSOR_INTERVAL_SEC", "10.0")
)

DEPOSIT_ATTEMPT_STAGES = {
    "SIGN_REQUESTED",
    "TX_BROADCASTED",
    "RECEIPT_FAILED",
    "RECEIPT_CONFIRMED",
    "INTENT_REGISTERED",
}
INVALID_TX_HASH_MESSAGE = "txHash must be a 66-char 0x-prefixed hash."
