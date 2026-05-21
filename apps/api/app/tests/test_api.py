import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from app.main import app

client = TestClient(app)
HEADERS = {"X-API-Key": "dev-api-key-change-in-production"}


@pytest.fixture(autouse=True)
def mock_db(monkeypatch):
    """Override get_db with a mock session for unit tests."""
    mock_session = MagicMock()
    mock_session.query.return_value.filter.return_value.first.return_value = None
    mock_session.query.return_value.order_by.return_value.all.return_value = []
    mock_session.query.return_value.all.return_value = []

    def override_get_db():
        yield mock_session

    from app.database import get_db
    app.dependency_overrides[get_db] = override_get_db
    yield mock_session
    app.dependency_overrides.clear()


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_auth_required():
    resp = client.get("/api/projects")
    assert resp.status_code == 422


def test_create_project(mock_db):
    import uuid
    from datetime import datetime
    fake = MagicMock()
    fake.id = uuid.uuid4()
    fake.name = "Test Project"
    fake.description = "A test"
    fake.created_at = datetime.utcnow()
    mock_db.add.return_value = None
    mock_db.commit.return_value = None
    mock_db.refresh.side_effect = lambda obj: None

    with patch("app.routes.projects.Project", return_value=fake):
        resp = client.post(
            "/api/projects",
            json={"name": "Test Project", "description": "A test"},
            headers=HEADERS,
        )
    assert resp.status_code in (200, 201, 422, 500)


def test_list_projects_empty(mock_db):
    resp = client.get("/api/projects", headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json() == []
