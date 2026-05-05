import pytest
from pydantic import ValidationError

from src.api.schemas.pydantic_models import (
    REFUND_FAIL_MESSAGE_MAX_LENGTH,
    RefundFailRequest,
)


def test_refund_fail_request_truncates_long_chain_revert_message() -> None:
    request = RefundFailRequest(
        reasonCode="TX_FAILED",
        message="Execution reverted with reason: " + ("raw-call " * 200),
    )

    assert request.message is not None
    assert len(request.message) == REFUND_FAIL_MESSAGE_MAX_LENGTH
    assert request.message.startswith("Execution reverted")


def test_refund_fail_request_still_rejects_non_string_message() -> None:
    with pytest.raises(ValidationError):
        RefundFailRequest(reasonCode="TX_FAILED", message={"raw": "error"})
