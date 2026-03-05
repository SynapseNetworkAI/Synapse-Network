from fastapi.testclient import TestClient
from indexer.c_api.main import app as client_app
from indexer.admin_api.main import app as admin_app
from indexer.database.client_db import ClientBase, engine_client
from indexer.database.admin_db import AdminBase, engine_admin

def setup_module(module):
    ClientBase.metadata.create_all(bind=engine_client)
    AdminBase.metadata.create_all(bind=engine_admin)

client_api = TestClient(client_app)
admin_api = TestClient(admin_app)

def test_client_api_unauthorized_access():
    """Client API should reject requests without proper headers."""
    response = client_api.get("/api/client/tasks?agent=0x123")
    assert response.status_code in [401, 403], "Should deny access without Bearer token"
    
def test_client_api_authorized_access():
    """Client API should allow requests with valid headers."""
    response = client_api.get("/api/client/tasks?agent=0x123", headers={"Authorization": "Bearer active"})
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_admin_api_unauthorized_access():
    """Admin API should reject requests without god_mode_active headers."""
    response = admin_api.get("/api/admin/tasks")
    assert response.status_code in [401, 403], "Should deny admin access without token"
    
def test_admin_api_authorized_access():
    """Admin API should allow requests with valid admin headers."""
    response = admin_api.get("/api/admin/tasks", headers={"Authorization": "Bearer god_mode_active"})
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_cross_auth_isolation():
    """Client token should NOT work on Admin endpoints, and vice versa."""
    # Try using client token on admin API
    res_admin = admin_api.get("/api/admin/tasks", headers={"Authorization": "Bearer active"})
    assert res_admin.status_code == 403, "Admin API should reject client token"
    
    # Try using admin token on client API
    res_client = client_api.get("/api/client/tasks?agent=0x123", headers={"Authorization": "Bearer god_mode_active"})
    assert res_client.status_code == 403, "Client API should reject admin token"
    
def test_database_isolation():
    """Client DB configuration should differ from Admin DB configuration to prevent cross-contamination."""
    from indexer.database.client_db import DATABASE_URL_CLIENT
    from indexer.database.admin_db import DATABASE_URL_ADMIN
    
    assert DATABASE_URL_CLIENT != DATABASE_URL_ADMIN, "Database pointers must be isolated!"
    assert "client" in DATABASE_URL_CLIENT.lower()
    assert "admin" in DATABASE_URL_ADMIN.lower()
