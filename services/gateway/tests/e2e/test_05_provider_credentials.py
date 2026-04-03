"""Step 5: Fresh provider wallet auth + provider credentials."""
from tests.e2e.conftest import GATEWAY_BASE, SESSION_ID
from tests.e2e.helpers.gateway import issue_provider_secret, list_provider_secrets


PROVIDER_SECRET_NAME = f"e2e-provider-secret-{SESSION_ID}"


def test_fresh_provider_wallet_can_issue_secret(
    fresh_provider_headers, fresh_provider_account, session_state
):
    body = issue_provider_secret(
        GATEWAY_BASE,
        fresh_provider_headers,
        name=PROVIDER_SECRET_NAME,
        rpm=180,
        credit_limit=25.0,
    )
    assert body.get("status") == "success", f"unexpected secret response: {body}"
    secret = body.get("secret") or {}
    secret_id = secret.get("id")
    secret_key = secret.get("secretKey")
    assert secret_id, f"provider secret id missing: {body}"
    assert secret_key and secret_key.startswith("agt_"), (
        f"provider secret key missing or malformed: {body}"
    )
    assert secret.get("ownerAddress") == fresh_provider_account.address.lower()

    session_state["fresh_provider_secret_id"] = secret_id
    session_state["fresh_provider_secret_key"] = secret_key
    session_state["fresh_provider_address"] = fresh_provider_account.address.lower()


def test_fresh_provider_secret_visible_in_list(
    fresh_provider_headers, session_state
):
    secrets = list_provider_secrets(GATEWAY_BASE, fresh_provider_headers)
    secret_id = session_state.get("fresh_provider_secret_id")
    assert secret_id, "fresh_provider_secret_id missing from previous step"

    matched = [row for row in secrets if row.get("id") == secret_id]
    assert matched, f"provider secret {secret_id} not found in list: {secrets}"
    assert matched[0].get("name") == PROVIDER_SECRET_NAME
