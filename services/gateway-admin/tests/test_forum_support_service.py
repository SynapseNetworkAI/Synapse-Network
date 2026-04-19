from __future__ import annotations

import pytest

from src.core.errors import BadRequestError
from src.services.auth.service import AdminIdentity
from src.services.forum_support.service import ForumSupportService


class LockedTopicRepository:
    def send_reply(self, **_kwargs):
        raise ValueError("Topic is locked")


def test_forum_support_service_rejects_locked_topic_replies() -> None:
    service = ForumSupportService(LockedTopicRepository())  # type: ignore[arg-type]
    admin = AdminIdentity(
        admin_id="adm_ops",
        email="ops@synapse.network",
        display_name="Ops",
        role="platform_ops_admin",
        permissions=("support:reply",),
    )

    with pytest.raises(BadRequestError, match="Topic is locked"):
        service.send_reply(
            "frt_locked",
            {
                "body": "Thanks, we are reviewing this.",
                "authorDisplay": "Synapse Ops",
                "authorAddress": "synapse:ops",
            },
            admin=admin,
        )
