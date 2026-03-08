from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL_ADMIN = "sqlite:///./indexer_admin.db"
engine_admin = create_engine(DATABASE_URL_ADMIN, connect_args={"check_same_thread": False})
SessionAdmin = sessionmaker(autocommit=False, autoflush=False, bind=engine_admin)
AdminBase = declarative_base()

def get_admin_db():
    db = SessionAdmin()
    try:
        yield db
    finally:
        db.close()
