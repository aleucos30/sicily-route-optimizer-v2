import os
import pytest
import requests
from pymongo import MongoClient
from datetime import datetime, timezone, timedelta
import uuid

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://palermo-routes.preview.emergentagent.com"
).rstrip("/")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "speedymap_database")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def mongo_db():
    c = MongoClient(MONGO_URL)
    return c[DB_NAME]


@pytest.fixture(scope="session")
def seeded_user(mongo_db):
    """Insert a TEST_ user + valid session, yield (user, token); cleanup after."""
    user_id = f"user_TEST_{uuid.uuid4().hex[:8]}"
    email = f"TEST_{uuid.uuid4().hex[:6]}@speedymap.test"
    token = f"TEST_tok_{uuid.uuid4().hex}"
    mongo_db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": "TEST User",
        "picture": None,
        "vehicle_size": "medium",
        "ztl_pass": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    mongo_db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    yield {"user_id": user_id, "email": email, "token": token}
    mongo_db.user_sessions.delete_many({"user_id": user_id})
    mongo_db.users.delete_many({"user_id": user_id})
    mongo_db.deliveries.delete_many({"user_id": user_id})


@pytest.fixture
def auth_headers(seeded_user):
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {seeded_user['token']}",
    }
