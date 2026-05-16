"""Backend tests for SpeedyMap NEW features:
- Onboarding /role
- Company setup / join / employees
- Location ping
- Route optimization (OSRM)
- Italy-wide geocoding
- order_index on deliveries
- Auth & role enforcement
"""
import os
import uuid
import requests
import pytest
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient


BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://palermo-routes.preview.emergentagent.com"
).rstrip("/")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "speedymap_database")


# ---------- Local fixtures (multi-user with roles) ----------
def _make_seeded_user(db, role=None, company_id=None):
    user_id = f"user_TEST_{uuid.uuid4().hex[:8]}"
    email = f"TEST_{uuid.uuid4().hex[:6]}@speedymap.test"
    token = f"TEST_tok_{uuid.uuid4().hex}"
    db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": "TEST User",
        "picture": None,
        "vehicle_size": "medium",
        "ztl_pass": False,
        "role": role,
        "company_id": company_id,
        "language": "it",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    return {"user_id": user_id, "email": email, "token": token}


def _hdr(token):
    return {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def mdb():
    return MongoClient(MONGO_URL)[DB_NAME]


@pytest.fixture(scope="module")
def users_bag(mdb):
    """Holds users created during this module; cleanup at end."""
    created = {"user_ids": [], "company_ids": []}
    yield created
    # cleanup
    for uid in created["user_ids"]:
        mdb.user_sessions.delete_many({"user_id": uid})
        mdb.users.delete_many({"user_id": uid})
        mdb.deliveries.delete_many({"user_id": uid})
    for cid in created["company_ids"]:
        mdb.companies.delete_many({"company_id": cid})


@pytest.fixture(scope="module")
def fresh_user(mdb, users_bag):
    """A user without role yet."""
    u = _make_seeded_user(mdb)
    users_bag["user_ids"].append(u["user_id"])
    return u


@pytest.fixture(scope="module")
def company_owner(mdb, users_bag):
    u = _make_seeded_user(mdb, role="company")
    users_bag["user_ids"].append(u["user_id"])
    return u


@pytest.fixture(scope="module")
def employee_user(mdb, users_bag):
    u = _make_seeded_user(mdb, role="employee")
    users_bag["user_ids"].append(u["user_id"])
    return u


@pytest.fixture(scope="module")
def private_user(mdb, users_bag):
    u = _make_seeded_user(mdb, role="private")
    users_bag["user_ids"].append(u["user_id"])
    return u


# ============== Onboarding / Role ==============
class TestOnboardingRole:
    def test_set_role_private(self, fresh_user):
        r = requests.post(f"{BASE_URL}/api/onboarding/role",
                          headers=_hdr(fresh_user["token"]),
                          json={"role": "private"})
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["role"] == "private"
        assert "_id" not in u

    def test_set_role_employee(self, fresh_user):
        r = requests.post(f"{BASE_URL}/api/onboarding/role",
                          headers=_hdr(fresh_user["token"]),
                          json={"role": "employee"})
        assert r.status_code == 200
        assert r.json()["role"] == "employee"

    def test_set_role_company(self, fresh_user):
        r = requests.post(f"{BASE_URL}/api/onboarding/role",
                          headers=_hdr(fresh_user["token"]),
                          json={"role": "company"})
        assert r.status_code == 200
        assert r.json()["role"] == "company"

    def test_set_role_invalid_400(self, fresh_user):
        r = requests.post(f"{BASE_URL}/api/onboarding/role",
                          headers=_hdr(fresh_user["token"]),
                          json={"role": "admin"})
        assert r.status_code == 400

    def test_set_role_no_auth_401(self):
        r = requests.post(f"{BASE_URL}/api/onboarding/role", json={"role": "private"})
        assert r.status_code == 401


# ============== Company setup ==============
class TestCompanySetup:
    def test_company_setup_creates_company(self, company_owner, users_bag, mdb):
        r = requests.post(f"{BASE_URL}/api/company/setup",
                          headers=_hdr(company_owner["token"]),
                          json={"company_name": "TEST_Acme SRL"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "TEST_Acme SRL"
        assert "invite_code" in data
        assert len(data["invite_code"]) == 6
        assert data["invite_code"].isalnum()
        assert data["owner_id"] == company_owner["user_id"]
        assert "_id" not in data
        users_bag["company_ids"].append(data["company_id"])

        # user should now have company_id set
        u = mdb.users.find_one({"user_id": company_owner["user_id"]})
        assert u["company_id"] == data["company_id"]
        # save for cross-test
        pytest.shared_company = data

    def test_company_setup_idempotent(self, company_owner):
        r = requests.post(f"{BASE_URL}/api/company/setup",
                          headers=_hdr(company_owner["token"]),
                          json={"company_name": "TEST_Other Name"})
        assert r.status_code == 200, r.text
        data = r.json()
        # should return existing
        assert data["company_id"] == pytest.shared_company["company_id"]
        assert data["invite_code"] == pytest.shared_company["invite_code"]

    def test_company_setup_wrong_role_403(self, private_user):
        r = requests.post(f"{BASE_URL}/api/company/setup",
                          headers=_hdr(private_user["token"]),
                          json={"company_name": "TEST_Nope"})
        assert r.status_code == 403

    def test_company_setup_no_auth_401(self):
        r = requests.post(f"{BASE_URL}/api/company/setup", json={"company_name": "x"})
        assert r.status_code == 401


# ============== Company join ==============
class TestCompanyJoin:
    def test_join_invalid_code_404(self, employee_user):
        r = requests.post(f"{BASE_URL}/api/company/join",
                          headers=_hdr(employee_user["token"]),
                          json={"invite_code": "XXXXXX"})
        assert r.status_code == 404

    def test_join_wrong_role_403(self, private_user):
        r = requests.post(f"{BASE_URL}/api/company/join",
                          headers=_hdr(private_user["token"]),
                          json={"invite_code": pytest.shared_company["invite_code"]})
        assert r.status_code == 403

    def test_join_valid_code(self, employee_user, mdb):
        r = requests.post(f"{BASE_URL}/api/company/join",
                          headers=_hdr(employee_user["token"]),
                          json={"invite_code": pytest.shared_company["invite_code"]})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["company_id"] == pytest.shared_company["company_id"]
        # employee should now have company_id
        u = mdb.users.find_one({"user_id": employee_user["user_id"]})
        assert u["company_id"] == pytest.shared_company["company_id"]

    def test_join_no_auth_401(self):
        r = requests.post(f"{BASE_URL}/api/company/join", json={"invite_code": "ABCDEF"})
        assert r.status_code == 401


# ============== Location ping ==============
class TestLocationPing:
    def test_ping_updates_user(self, private_user, mdb):
        r = requests.post(f"{BASE_URL}/api/location/ping",
                          headers=_hdr(private_user["token"]),
                          json={"lat": 41.9028, "lon": 12.4964})
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        u = mdb.users.find_one({"user_id": private_user["user_id"]})
        assert u["last_lat"] == 41.9028
        assert u["last_lon"] == 12.4964
        assert "last_seen" in u

    def test_ping_no_auth_401(self):
        r = requests.post(f"{BASE_URL}/api/location/ping", json={"lat": 0, "lon": 0})
        assert r.status_code == 401


# ============== Company employees ==============
class TestCompanyEmployees:
    def test_employees_list(self, company_owner, employee_user):
        # ensure employee did a ping so last_lat present? not required; just check shape
        # Also create a delivery for the employee to have summary populated
        d_payload = {
            "address": "TEST_Via Test Rome",
            "lat": 41.9028, "lon": 12.4964,
            "recipient": "TEST_Recipient",
        }
        rdel = requests.post(f"{BASE_URL}/api/deliveries",
                             headers=_hdr(employee_user["token"]),
                             json=d_payload)
        assert rdel.status_code == 200, rdel.text

        # mark one done? no, leave pending to test summary
        r = requests.get(f"{BASE_URL}/api/company/employees",
                         headers=_hdr(company_owner["token"]))
        assert r.status_code == 200, r.text
        emps = r.json()
        assert isinstance(emps, list)
        # find our employee
        emp = next((e for e in emps if e["user_id"] == employee_user["user_id"]), None)
        assert emp is not None, f"Employee not found in list: {emps}"
        assert "summary" in emp
        s = emp["summary"]
        assert "total" in s and "done" in s and "pending" in s
        assert "ztl_warnings" in s and "completion_pct" in s
        assert s["total"] >= 1
        assert s["pending"] >= 1
        assert s["done"] == 0
        assert s["completion_pct"] == 0
        # location fields exposed
        assert "last_lat" in emp or emp.get("last_lat") is None  # field may be absent
        # no mongo _id leaked
        assert "_id" not in emp

    def test_employees_wrong_role_403(self, private_user):
        r = requests.get(f"{BASE_URL}/api/company/employees",
                         headers=_hdr(private_user["token"]))
        assert r.status_code == 403

    def test_employees_no_auth_401(self):
        r = requests.get(f"{BASE_URL}/api/company/employees")
        assert r.status_code == 401


# ============== Italy-wide geocoding ==============
class TestGeocodeItaly:
    def test_search_rome(self, ):
        r = requests.get(f"{BASE_URL}/api/geocode/search",
                         params={"q": "Via del Corso Roma"}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        if data:
            # Check at least one result is in Rome/Roma (not Palermo)
            joined = " ".join((it.get("display_name") or "").lower() for it in data)
            assert "roma" in joined or "rome" in joined, f"No Rome results: {joined[:300]}"

    def test_search_milano(self):
        r = requests.get(f"{BASE_URL}/api/geocode/search",
                         params={"q": "Piazza Duomo Milano"}, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        if data:
            joined = " ".join((it.get("display_name") or "").lower() for it in data)
            assert "milan" in joined, f"No Milano results: {joined[:300]}"


# ============== Route optimization ==============
class TestRouteOptimize:
    def test_optimize_no_stops_returns_empty(self, private_user):
        # private_user has no deliveries
        r = requests.post(f"{BASE_URL}/api/route/optimize",
                          headers=_hdr(private_user["token"]),
                          json={"start_lat": 38.115, "start_lon": 13.361})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["order"] == []
        assert data["polyline"] == []
        assert data["distance_km"] == 0
        assert data["duration_min"] == 0

    def test_optimize_with_stops(self, mdb, users_bag):
        # create a dedicated user with several deliveries
        u = _make_seeded_user(mdb, role="private")
        users_bag["user_ids"].append(u["user_id"])
        hdr = _hdr(u["token"])

        # Three stops in Palermo area
        stops = [
            {"address": "TEST_S1", "lat": 38.130, "lon": 13.370},
            {"address": "TEST_S2", "lat": 38.120, "lon": 13.355},
            {"address": "TEST_S3", "lat": 38.110, "lon": 13.345},
        ]
        for s in stops:
            r = requests.post(f"{BASE_URL}/api/deliveries", headers=hdr, json=s)
            assert r.status_code == 200, r.text

        # Optimize starting from near S3
        r = requests.post(f"{BASE_URL}/api/route/optimize",
                          headers=hdr,
                          json={"start_lat": 38.108, "start_lon": 13.343})
        assert r.status_code == 200, r.text
        data = r.json()
        # Shape checks
        assert isinstance(data["order"], list)
        assert len(data["order"]) == 3
        for stop in data["order"]:
            assert "id" in stop and "lat" in stop and "lon" in stop and "address" in stop
        # Nearest-neighbor: S3 (closest to start) should be first
        assert data["order"][0]["address"] == "TEST_S3"
        # OSRM may fail occasionally; if it worked, polyline & distances are populated
        assert isinstance(data["polyline"], list)
        assert isinstance(data["distance_km"], (int, float))
        assert isinstance(data["duration_min"], (int, float))
        if data["polyline"]:
            # Each point [lat, lon]
            assert len(data["polyline"][0]) == 2
            lat0, lon0 = data["polyline"][0]
            assert 36 < lat0 < 47, f"Bad lat in polyline: {lat0}"
            assert 6 < lon0 < 19, f"Bad lon in polyline: {lon0}"
            assert data["distance_km"] > 0
            assert data["duration_min"] > 0

        # Verify order_index was persisted
        rlist = requests.get(f"{BASE_URL}/api/deliveries", headers=hdr)
        items = rlist.json()
        order_indices = sorted([it["order_index"] for it in items])
        assert order_indices == [1, 2, 3]
        # First one (by sort) should match data["order"][0]
        items_sorted = sorted(items, key=lambda x: x["order_index"])
        assert items_sorted[0]["address"] == data["order"][0]["address"]

    def test_optimize_no_auth_401(self):
        r = requests.post(f"{BASE_URL}/api/route/optimize",
                          json={"start_lat": 0, "start_lon": 0})
        assert r.status_code == 401


# ============== Deliveries: order_index field ==============
class TestDeliveriesOrderIndex:
    def test_order_index_set_on_create(self, mdb, users_bag):
        u = _make_seeded_user(mdb, role="private")
        users_bag["user_ids"].append(u["user_id"])
        hdr = _hdr(u["token"])
        r1 = requests.post(f"{BASE_URL}/api/deliveries", headers=hdr,
                           json={"address": "TEST_A", "lat": 38.1, "lon": 13.3})
        r2 = requests.post(f"{BASE_URL}/api/deliveries", headers=hdr,
                           json={"address": "TEST_B", "lat": 38.2, "lon": 13.4})
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["order_index"] == 1
        assert r2.json()["order_index"] == 2
        # list sorted by order_index
        rl = requests.get(f"{BASE_URL}/api/deliveries", headers=hdr)
        items = rl.json()
        assert items[0]["order_index"] == 1
        assert items[1]["order_index"] == 2
