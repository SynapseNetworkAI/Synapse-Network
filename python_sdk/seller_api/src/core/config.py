import os

class Settings:
    environment: str = os.getenv("ENVIRONMENT", "development")
    rpc_url: str = os.getenv("RPC_URL", "http://127.0.0.1:8545")
    private_key: str = os.getenv("PRIVATE_KEY", "")
    contract_address: str = os.getenv("CONTRACT_ADDRESS", "")
    data_dir: str = os.getenv("DATA_DIR", ".")
    jwt_secret: str = os.getenv("JWT_SECRET", "super-secret-key-change-me")
    host: str = os.getenv("HOST", "0.0.0.1")
    port: int = int(os.getenv("PORT", "5000"))

settings = Settings()
