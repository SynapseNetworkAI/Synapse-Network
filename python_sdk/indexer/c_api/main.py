import threading
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from indexer.database.client_db import ClientBase, engine_client, SessionClient
from indexer.models.client_models import ClientTaskModel, ClientSyncState
from indexer.models.agent_models import AgentModel
from indexer.c_api.routes import router as client_router
from indexer.sync_daemon import listen_to_events

app = FastAPI(title="A2A-Pay Client API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    # Initialize separate client DB
    ClientBase.metadata.create_all(bind=engine_client)
    # Start sync daemon configured ONLY for client database
    threading.Thread(
        target=listen_to_events, 
        args=(SessionClient, ClientTaskModel, ClientSyncState, "Client"), 
        daemon=True
    ).start()

app.include_router(client_router)

if __name__ == "__main__":
    import uvicorn
    # Default port for client API
    uvicorn.run("indexer.c_api.main:app", host="0.0.0.0", port=8000, reload=True)
