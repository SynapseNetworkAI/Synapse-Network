# pyright: reportMissingImports=false

from src.services import forwarding_service


def test_pricing_breakdown_uses_global_setting(monkeypatch, temp_json_storage):
    monkeypatch.setattr(forwarding_service.settings, "platform_fee_rate", 0.10)

    fee_rate, platform_fee, seller_net = forwarding_service._pricing_breakdown(
        temp_json_storage,
        "0xabc",
        1.0,
    )

    assert abs(fee_rate - 0.10) < 1e-9
    assert abs(platform_fee - 0.10) < 1e-9
    assert abs(seller_net - 0.90) < 1e-9


def test_pricing_breakdown_owner_override_takes_priority(monkeypatch, temp_json_storage):
    monkeypatch.setattr(forwarding_service.settings, "platform_fee_rate", 0.10)
    temp_json_storage.save_collection(
        "platform_fee_policy",
        {
            "defaultRate": 0.08,
            "ownerRates": {
                "0xd856907d7e35a8f9bd225859a59e58577147a092": 0.03,
            },
        },
    )

    fee_rate, platform_fee, seller_net = forwarding_service._pricing_breakdown(
        temp_json_storage,
        "0xD856907D7E35A8F9BD225859A59E58577147A092",
        2.0,
    )

    assert abs(fee_rate - 0.03) < 1e-9
    assert abs(platform_fee - 0.06) < 1e-9
    assert abs(seller_net - 1.94) < 1e-9


def test_pricing_breakdown_falls_back_to_runtime_default_rate(monkeypatch, temp_json_storage):
    monkeypatch.setattr(forwarding_service.settings, "platform_fee_rate", 0.15)
    temp_json_storage.save_collection(
        "platform_fee_policy",
        {
            "ownerRates": {},
        },
    )

    fee_rate, platform_fee, seller_net = forwarding_service._pricing_breakdown(
        temp_json_storage,
        "0xabc",
        2.0,
    )

    assert abs(fee_rate - 0.15) < 1e-9
    assert abs(platform_fee - 0.30) < 1e-9
    assert abs(seller_net - 1.70) < 1e-9


def test_pricing_breakdown_invalid_rate_is_clamped(monkeypatch, temp_json_storage):
    monkeypatch.setattr(forwarding_service.settings, "platform_fee_rate", 0.10)
    temp_json_storage.save_collection(
        "platform_fee_policy",
        {
            "defaultRate": 1.8,
            "ownerRates": {
                "0xabc": -0.2,
            },
        },
    )

    fee_rate, platform_fee, seller_net = forwarding_service._pricing_breakdown(
        temp_json_storage,
        "0xabc",
        1.0,
    )

    assert abs(fee_rate - 0.0) < 1e-9
    assert abs(platform_fee - 0.0) < 1e-9
    assert abs(seller_net - 1.0) < 1e-9
