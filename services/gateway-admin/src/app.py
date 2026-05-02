from contextlib import asynccontextmanager
import asyncio
import hmac
import time

from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.api.routers import (
	admin_auth,
	admin_config,
	admin_users,
	approval,
	audit,
	dashboard,
	execution,
	forum_support,
	ops_webhooks,
	platform_fee_treasury,
	provider_services,
	provider_withdraw_review,
)
from src.api import deps
from src.core.csrf import build_admin_csrf_token
from src.core.config import get_settings
from src.core.errors import AppError
from src.core.log_config import setup_logger
from src.core.metrics import MetricsRegistry, metrics_response, observe_request_metrics
from src.core.middleware import RequestContextMiddleware

setup_logger()
settings = get_settings()


def _should_enforce_csrf(request: Request) -> bool:
	if request.method in {"GET", "HEAD", "OPTIONS"}:
		return False
	if not request.url.path.startswith("/api/admin/v1/"):
		return False
	if request.url.path == "/api/admin/v1/auth/login":
		return False
	if request.headers.get("Authorization"):
		return False
	return bool(request.cookies.get(settings.admin_session_cookie_name))


def _invalid_csrf_response(request: Request) -> JSONResponse:
	request_id = getattr(request.state, "request_id", "req_unknown")
	return JSONResponse(
		status_code=403,
		content={
			"success": False,
			"error": {"code": "FORBIDDEN", "message": "Invalid CSRF token"},
			"requestId": request_id,
		},
	)


def _register_exception_handlers(app: FastAPI) -> None:
	@app.exception_handler(AppError)
	async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
		request_id = getattr(request.state, "request_id", "req_unknown")
		content = {
			"success": False,
			"error": {"code": exc.code, "message": exc.message},
			"requestId": request_id,
		}
		if exc.data is not None:
			content["data"] = exc.data
		return JSONResponse(
			status_code=exc.status_code,
			content=content,
		)

	@app.exception_handler(HTTPException)
	async def handle_http_error(request: Request, exc: HTTPException) -> JSONResponse:
		request_id = getattr(request.state, "request_id", "req_unknown")
		return JSONResponse(
			status_code=exc.status_code,
			content={
				"success": False,
				"error": {
					"code": f"HTTP_{exc.status_code}",
					"message": str(exc.detail),
				},
				"requestId": request_id,
			},
		)

	@app.exception_handler(RequestValidationError)
	async def handle_validation_error(
		request: Request, exc: RequestValidationError
	) -> JSONResponse:
		request_id = getattr(request.state, "request_id", "req_unknown")
		first_error = exc.errors()[0] if exc.errors() else None
		message = first_error.get("msg", "Validation failed") if first_error else "Validation failed"
		return JSONResponse(
			status_code=422,
			content={
				"success": False,
				"error": {"code": "VALIDATION_ERROR", "message": message},
				"requestId": request_id,
			},
		)

	@app.exception_handler(Exception)
	async def handle_unknown_error(request: Request, _: Exception) -> JSONResponse:
		request_id = getattr(request.state, "request_id", "req_unknown")
		return JSONResponse(
			status_code=500,
			content={
				"success": False,
				"error": {"code": "INTERNAL_ERROR", "message": "Internal server error"},
				"requestId": request_id,
			},
		)


def _readiness_snapshot(app: FastAPI) -> dict[str, object]:
	worker_enabled = bool(settings.execution_worker_enabled)
	worker_task = getattr(app.state, "execution_worker_task", None)
	worker_ready = (not worker_enabled) or (
		worker_task is not None and not worker_task.done()
	)
	components = {
		"admin_database": {"configured": bool(settings.admin_database_dsn)},
		"gateway_adapter": {"configured": bool(settings.gateway_internal_base_url)},
		"analytics_clickhouse": {"configured": bool(settings.analytics_clickhouse_url)},
		"execution_worker": {
			"enabled": worker_enabled,
			"initialized": worker_ready,
		},
	}
	ready = all(
		component.get("configured", True) and component.get("initialized", True)
		for component in components.values()
	)
	return {"status": "ready" if ready else "degraded", "components": components}


def _register_metrics_and_health_routes(app: FastAPI) -> None:
	@app.get("/health")
	async def health_check() -> dict[str, str]:
		return {"status": "ok", "service": "gateway-admin", "version": "0.1.0"}

	@app.get("/readiness")
	async def readiness_check(request: Request, response: Response) -> dict[str, object]:
		snapshot = _readiness_snapshot(request.app)
		if snapshot["status"] != "ready":
			response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
		return snapshot

	@app.get("/metrics")
	async def metrics(request: Request) -> Response:
		return metrics_response(
			request,
			request.app.state.metrics,
			bearer_token=settings.metrics_bearer_token,
			basic_username=settings.metrics_basic_username,
			basic_password=settings.metrics_basic_password,
		)


@asynccontextmanager
async def lifespan(app: FastAPI):
	app.state.settings = settings
	worker_task = None
	worker_stop_event = asyncio.Event()
	if settings.execution_worker_enabled:
		worker = deps.get_execution_worker()
		worker_task = asyncio.create_task(worker.run(worker_stop_event))
		app.state.execution_worker = worker
		app.state.execution_worker_task = worker_task
		app.state.execution_worker_stop_event = worker_stop_event
	try:
		yield
	finally:
		worker_stop_event.set()
		if worker_task is not None:
			await worker_task


def create_app() -> FastAPI:
	app = FastAPI(
		title=settings.app_name,
		description="Synapse admin control plane.",
		version="0.1.0",
		lifespan=lifespan,
	)
	app.state.metrics = MetricsRegistry(service="gateway-admin")

	app.add_middleware(RequestContextMiddleware)

	app.add_middleware(
		CORSMiddleware,
		allow_origins=settings.cors_origins(),
		allow_credentials=True,
		allow_methods=["*"],
		allow_headers=["*"],
	)

	@app.middleware("http")
	async def collect_runtime_metrics(request: Request, call_next):
		if request.url.path == "/metrics":
			return await call_next(request)
		started_at = time.perf_counter()
		status_code = 500
		try:
			response = await call_next(request)
			status_code = response.status_code
			return response
		finally:
			observe_request_metrics(
				request.app.state.metrics,
				request=request,
				started_at=started_at,
				status_code=status_code,
			)

	@app.middleware("http")
	async def enforce_cookie_csrf(request: Request, call_next):
		if not _should_enforce_csrf(request):
			return await call_next(request)
		session_token = request.cookies.get(settings.admin_session_cookie_name)
		csrf_token = request.headers.get("X-CSRF-Token")
		expected_token = build_admin_csrf_token(session_token)
		if not csrf_token or not hmac.compare_digest(csrf_token, expected_token):
			return _invalid_csrf_response(request)
		return await call_next(request)

	app.include_router(admin_auth.router)
	app.include_router(admin_config.router)
	app.include_router(admin_users.router)
	app.include_router(dashboard.router)
	app.include_router(approval.router)
	app.include_router(audit.router)
	app.include_router(execution.router)
	app.include_router(forum_support.router)
	app.include_router(ops_webhooks.router)
	app.include_router(platform_fee_treasury.router)
	app.include_router(provider_services.router)
	app.include_router(provider_withdraw_review.router)

	_register_exception_handlers(app)
	_register_metrics_and_health_routes(app)

	return app


app = create_app()
