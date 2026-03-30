from fastapi import APIRouter

from app.api.v1.endpoints.oss_security_healthcheck import (
    router as oss_security_healthcheck_router,
)
from app.api.v1.endpoints.github_release_asset_download import (
    router as github_release_asset_download_router,
)
from app.api.v1.endpoints.paper_pdf_download import (
    router as paper_pdf_download_router,
)
from app.api.v1.endpoints.protocol_fundamental_brief import (
    router as protocol_fundamental_brief_router,
)
from app.api.v1.endpoints.reddit_media_download import (
    router as reddit_media_download_router,
)
from app.api.v1.endpoints.quotes import router as quotes_router
from app.api.v1.endpoints.sentiment import router as sentiment_router
from app.api.v1.endpoints.smart_contract_audit import (
    router as smart_contract_audit_router,
)
from app.api.v1.endpoints.tiktok_video_download import (
    router as tiktok_video_download_router,
)
from app.api.v1.endpoints.whale_flow_monitor import (
    router as whale_flow_monitor_router,
)
from app.api.v1.endpoints.twitter_video_download import (
    router as twitter_video_download_router,
)
from app.api.v1.endpoints.youtube_video_download import (
    router as youtube_video_download_router,
)

api_v1_router = APIRouter()
api_v1_router.include_router(quotes_router)
api_v1_router.include_router(sentiment_router)
api_v1_router.include_router(protocol_fundamental_brief_router)
api_v1_router.include_router(smart_contract_audit_router)
api_v1_router.include_router(whale_flow_monitor_router)
api_v1_router.include_router(oss_security_healthcheck_router)
api_v1_router.include_router(twitter_video_download_router)
api_v1_router.include_router(tiktok_video_download_router)
api_v1_router.include_router(reddit_media_download_router)
api_v1_router.include_router(youtube_video_download_router)
api_v1_router.include_router(github_release_asset_download_router)
api_v1_router.include_router(paper_pdf_download_router)
