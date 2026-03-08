from indexer.database.client_db import engine_client, ClientBase
from indexer.models.client_models import ClientTaskModel

print("Dropping existing client_tasks table...")
ClientTaskModel.__table__.drop(engine_client, checkfirst=True)
print("Recreating tables...")
ClientBase.metadata.create_all(engine_client)
print("Database upgrade complete.")
