from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.api.routers import admin_auth, approval, dashboard
from src.core.config import get_settings
from src.core.errors import AppError
from src.core.middleware import RequestContextMiddleware

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
	app.state.settings = settings
	yield


def create_app() -> FastAPI:
	app = FastAPI(
		title=settings.app_name,
		description="Synapse admin control plane.",
		version="0.1.0",
		lifespan=lifespan,
	)

	app.add_middleware(RequestContextMiddleware)

	app.add_middleware(
		CORSMiddleware,
		allow_origins=settings.cors_origins(),
		allow_credentials=True,
		allow_methods=["*"],
		allow_headers=["*"],
	)

	app.include_router(admin_auth.router)
	app.include_router(dashboard.router)
	app.include_router(approval.router)

	@app.exception_handler(AppError)
	async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
		request_id = getattr(request.state, "request_id", "req_unknown")
		return JSONResponse(
			status_code=exc.status_code,
			content={
				"success": False,
				"error": {"code": exc.code, "message": exc.message},
				"requestId": request_id,
			},
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

	@app.get("/health")
	async def health_check() -> dict[str, str]:
		return {"status": "ok", "service": "gateway-admin", "version": "0.1.0"}

	return app


app = create_app()
