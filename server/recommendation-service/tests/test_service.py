import os

os.environ["INTERNAL_SERVICE_KEY"] = "test-key"

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_requires_internal_service_key():
    assert client.get("/health").status_code == 403
    response = client.get("/health", headers={"x-internal-service-key": "test-key"})
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_metrics_requires_internal_service_key_and_exposes_counter():
    assert client.get("/metrics").status_code == 403
    response = client.get("/metrics", headers={"x-internal-service-key": "test-key"})
    assert response.status_code == 200
    assert "recommendation_service_requests_total" in response.text
