from decimal import Decimal

import pytest

from src.utils.money import MoneyCodec, money_str, usdc_decimal_to_atomic


def test_money_codec_rejects_float_inputs() -> None:
    with pytest.raises(TypeError):
        MoneyCodec.coerce_decimal(0.1)  # type: ignore[arg-type]

    with pytest.raises(TypeError):
        money_str(0.1)  # type: ignore[arg-type]


def test_usdc_atomic_conversion_stays_decimal_safe() -> None:
    assert MoneyCodec.coerce_decimal("1.234567") == Decimal("1.234567")
    assert usdc_decimal_to_atomic(Decimal("1.234567"), decimals=18) == 1234567000000000000
