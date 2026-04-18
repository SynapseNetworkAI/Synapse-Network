from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Self


USDC_QUANTIZER = Decimal("0.000001")


class MoneyCodec:
    """Canonical Decimal helpers for all USDC-sensitive code paths."""

    quantizer: Decimal = USDC_QUANTIZER

    @classmethod
    def quantize_usdc(cls, value: Decimal | str | int) -> Decimal:
        if isinstance(value, bool):
            raise TypeError("bool is not a valid money value")
        if isinstance(value, float):
            raise TypeError("float is forbidden for money values")
        return Decimal(str(value)).quantize(cls.quantizer, rounding=ROUND_HALF_UP)

    @classmethod
    def coerce_decimal(cls, value: Decimal | str | int | float | None) -> Decimal:
        if value is None:
            return cls.quantize_usdc(Decimal("0"))
        if isinstance(value, bool):
            raise TypeError("bool is not a valid money value")
        if isinstance(value, float):
            return Decimal(str(value)).quantize(cls.quantizer, rounding=ROUND_HALF_UP)
        return cls.quantize_usdc(value)

    @classmethod
    def parse_usdc(cls, value: Decimal | str | int | None) -> Decimal:
        if value is None:
            return cls.quantize_usdc(Decimal("0"))
        return cls.quantize_usdc(value)

    @classmethod
    def from_atomic(cls, amount_atomic: int | str, *, decimals: int = 18) -> Decimal:
        return cls.quantize_usdc(Decimal(str(amount_atomic)) / (Decimal(10) ** decimals))

    @classmethod
    def to_atomic(cls, value: Decimal | str | int, *, decimals: int = 18) -> int:
        quantized = cls.quantize_usdc(value)
        return int(quantized * (Decimal(10) ** decimals))

    @classmethod
    def to_wire(cls, value: Decimal | str | int | float | None) -> str:
        return format(cls.coerce_decimal(value), "f")

    def with_quantizer(self, quantizer: Decimal) -> Self:
        self.quantizer = quantizer
        return self


def quantize_usdc(value: Decimal | str | int) -> Decimal:
    return MoneyCodec.quantize_usdc(value)


def parse_usdc(value: Decimal | str | int | None) -> Decimal:
    return MoneyCodec.parse_usdc(value)


def usdc_decimal_to_atomic(value: Decimal | str | int, *, decimals: int = 18) -> int:
    return MoneyCodec.to_atomic(value, decimals=decimals)


def atomic_to_usdc_decimal(amount_atomic: int | str, *, decimals: int = 18) -> Decimal:
    return MoneyCodec.from_atomic(amount_atomic, decimals=decimals)


def money_str(value: Decimal | str | int | float | None) -> str:
    return MoneyCodec.to_wire(value)
