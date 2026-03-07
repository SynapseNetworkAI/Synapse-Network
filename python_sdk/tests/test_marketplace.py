import pytest
from fastapi.testclient import TestClient
from indexer.c_api.main import app
from indexer.database.client_db import get_client_db, engine_client, ClientBase
from indexer.models.client_models import ClientTaskModel
from indexer.models.agent_models import AgentModel
from sqlalchemy.orm import sessionmaker

# Setup test DB
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_client)

def override_get_client_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_client_db] = override_get_client_db
client = TestClient(app)

# Test Data
USER_ADDRESS_1 = "0x1111111111111111111111111111111111111111"
USER_ADDRESS_2 = "0x2222222222222222222222222222222222222222"
AGENT_WALLET_1 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
AGENT_WALLET_2 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

@pytest.fixture(autouse=True)
def setup_db():
    # Setup fresh DB for each test
    ClientBase.metadata.create_all(bind=engine_client)
    db = TestingSessionLocal()
    
    # Clean previous test data
    db.query(ClientTaskModel).delete()
    db.query(AgentModel).delete()
    
    # Create test agents
    agent1 = AgentModel(
        id="agent-1",
        name="Test Agent 1",
        role="buyer",
        owner_address=USER_ADDRESS_1,
        agent_session_wallet=AGENT_WALLET_1
    )
    agent2 = AgentModel(
        id="agent-2",
        name="Test Agent 2",
        role="seller",
        owner_address=USER_ADDRESS_2,
        agent_session_wallet=AGENT_WALLET_2
    )
    db.add(agent1)
    db.add(agent2)
    db.commit()
    db.close()
    
    yield
    
    ClientBase.metadata.drop_all(bind=engine_client)

def test_marketplace_flow():
    # --- 1. PUBLISH TASK ---
    headers_user1 = {
        "Authorization": "Bearer active",
        "X-User-Address": USER_ADDRESS_1
    }
    
    res = client.post("/api/client/tasks/publish", json={
        "title": "Data Labeling",
        "description": "Label 100 images",
        "amount": "10.5",
        "buyer_agent": AGENT_WALLET_1
    }, headers=headers_user1)
    
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["status"] == "success"
    task_id = data["taskId"]
    
    # --- 2. CHECK MARKETPLACE ---
    res = client.get("/api/client/tasks/marketplace")
    assert res.status_code == 200
    tasks = res.json()
    assert len(tasks) == 1
    assert tasks[0]["taskId"] == task_id
    assert tasks[0]["status"] == "PENDING"
    
    # --- 3. ACCEPT TASK (By Agent 2) ---
    headers_user2 = {
        "Authorization": "Bearer active",
        "X-User-Address": USER_ADDRESS_2
    }
    
    res = client.post(f"/api/client/tasks/{task_id}/accept", json={
        "agent_wallet": AGENT_WALLET_2
    }, headers=headers_user2)
    
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "success"
    
    # Verify task state is PROCESSING
    db = TestingSessionLocal()
    task = db.query(ClientTaskModel).filter_by(task_id=task_id).first()
    assert task.status == "PROCESSING"
    assert task.seller == AGENT_WALLET_2
    db.close()
    
    # --- 4. DELIVER TASK (By Agent 2) ---
    res = client.post(f"/api/client/tasks/{task_id}/deliver", json={
        "agent_wallet": AGENT_WALLET_2,
        "result_data": "https://s3.aws.com/result.zip"
    }, headers=headers_user2)
    
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "success"
    
    # Verify task state is DELIVERED
    db = TestingSessionLocal()
    task = db.query(ClientTaskModel).filter_by(task_id=task_id).first()
    assert task.status == "DELIVERED"
    assert task.result_data == "https://s3.aws.com/result.zip"
    db.close()

def test_cannot_accept_own_task():
    # Publish Task
    headers_user1 = {
        "Authorization": "Bearer active",
        "X-User-Address": USER_ADDRESS_1
    }
    res = client.post("/api/client/tasks/publish", json={
        "title": "Data Labeling",
        "description": "Label 100 images",
        "amount": "10.5",
        "buyer_agent": AGENT_WALLET_1
    }, headers=headers_user1)
    task_id = res.json()["taskId"]
    
    # Accept Error (Agent 1 tries to accept Agent 1's task)
    res = client.post(f"/api/client/tasks/{task_id}/accept", json={
        "agent_wallet": AGENT_WALLET_1
    }, headers=headers_user1)
    
    assert res.status_code == 400
    assert "Cannot accept own task" in res.text
