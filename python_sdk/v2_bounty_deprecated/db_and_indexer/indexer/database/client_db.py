from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL_CLIENT = "sqlite:///./indexer_client.db"
engine_client = create_engine(DATABASE_URL_CLIENT, connect_args={"check_same_thread": False})
SessionClient = sessionmaker(autocommit=False, autoflush=False, bind=engine_client)
ClientBase = declarative_base()

def get_client_db():
    db = SessionClient()
    try:
        yield db
    finally:
        db.close()
