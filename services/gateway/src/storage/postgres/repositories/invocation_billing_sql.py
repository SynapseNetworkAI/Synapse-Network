from __future__ import annotations

from decimal import Decimal
import json
from typing import Any, Callable

from src.domain.runtime_state import InvocationBillingState


def upsert_invocation_billing(
    cur: Any,
    q6: Callable[[Any], Decimal],
    invocation_id: str,
    state: InvocationBillingState,
    updated_at: str,
) -> None:
    payload = state.model_dump(by_alias=True, mode="json")
    unit_price = q6(state.unit_price or Decimal("0"))
    protocol_fee = q6(state.protocol_fee or Decimal("0"))
    routing_tax = q6(state.routing_tax or Decimal("0"))
    charged = q6(state.total_charge or Decimal("0"))
    provider_earned = q6(max(unit_price - protocol_fee, Decimal("0")))
    cur.execute(
        """
        INSERT INTO synapse_invocation_billing (
            invocation_id, business_type, charged_usdc, unit_price_usdc,
            protocol_fee_usdc, routing_tax_usdc, provider_earned_usdc,
            payload, created_at, updated_at
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
        ON CONFLICT (invocation_id)
        DO UPDATE SET
            business_type = EXCLUDED.business_type,
            charged_usdc = EXCLUDED.charged_usdc,
            unit_price_usdc = EXCLUDED.unit_price_usdc,
            protocol_fee_usdc = EXCLUDED.protocol_fee_usdc,
            routing_tax_usdc = EXCLUDED.routing_tax_usdc,
            provider_earned_usdc = EXCLUDED.provider_earned_usdc,
            payload = EXCLUDED.payload,
            updated_at = EXCLUDED.updated_at
        """,
        (
            invocation_id,
            str(state.business_type or "charge"),
            str(charged),
            str(unit_price),
            str(protocol_fee),
            str(routing_tax),
            str(provider_earned),
            json.dumps(payload),
            updated_at,
            updated_at,
        ),
    )
