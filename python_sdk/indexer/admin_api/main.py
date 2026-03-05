import threading
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from indexer.database.admin_db import AdminBase, engine_admin, SessionAdmin
from indexer.models.admin_models import AdminTaskModel, AdminSyncState
from indexer.admin_api.routes import router as admin_router
from indexer.sync_daemon import listen_to_events

app = FastAPI(title="A2A-Pay Admin API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    # Initialize separate admin DB
    AdminBase.metadata.create_all(bind=engine_admin)
    # Start sync daemon configured ONLY for admin database
    threading.Thread(
        target=listen_to_events, 
        args=(SessionAdmin, AdminTaskModel, AdminSyncState, "Admin"), 
        daemon=True
    ).start()

app.include_router(admin_router)

if __name__ == "__main__":
    import uvicorn
    # Default port for admin API: 8001
    uvicorn.run("indexer.admin_api.main:app", host="0.0.0.0", port=8001, reload=True)
