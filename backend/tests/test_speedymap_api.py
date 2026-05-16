"""Backend tests for SpeedyMap API."""
import base64
import pytest
import requests


# ---------------- Health ----------------
class TestHealth:
    def test_root(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200
        assert r.json() == {"message": "SpeedyMap API"}


# ---------------- ZTL ----------------
class TestZTL:
    def test_polygon(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/ztl/polygon")
        assert r.status_code == 200
        data = r.json()
        assert "polygon" in data
        poly = data["polygon"]
        assert isinstance(poly, list) and len(poly) > 3
        for p in poly:
            assert "latitude" in p and "longitude" in p
            assert isinstance(p["latitude"], (int, float))
            assert isinstance(p["longitude"], (int, float))

    def test_check_inside(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/ztl/check", params={"lat": 38.117, "lon": 13.365})
        assert r.status_code == 200
        body = r.json()
        assert "in_ztl" in body
        assert body["in_ztl"] is True, f"Expected inside, got {body}"

    def test_check_outside(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/ztl/check", params={"lat": 38.200, "lon": 13.300})
        assert r.status_code == 200
        body = r.json()
        assert body["in_ztl"] is False


# ---------------- Geocode ----------------
class TestGeocode:
    def test_search_valid(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/geocode/search", params={"q": "Via Roma Palermo"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        if data:
            item = data[0]
            assert "display_name" in item
            assert "lat" in item and "lon" in item
            assert isinstance(item["lat"], float)
            assert isinstance(item["lon"], float)

    def test_search_too_short(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/geocode/search", params={"q": "ab"})
        assert r.status_code == 200
        assert r.json() == []


# ---------------- Auth ----------------
class TestAuth:
    def test_session_invalid_id(self, api_client, base_url):
        r = api_client.post(f"{base_url}/api/auth/session", json={"session_id": "invalid_xxx_123"})
        assert r.status_code == 401

    def test_me_without_token(self, api_client, base_url):
        r = requests.get(f"{base_url}/api/auth/me")
        assert r.status_code == 401

    def test_me_with_bad_token(self, base_url):
        r = requests.get(f"{base_url}/api/auth/me", headers={"Authorization": "Bearer notreal"})
        assert r.status_code == 401

    def test_me_with_valid_token(self, base_url, seeded_user):
        r = requests.get(
            f"{base_url}/api/auth/me",
            headers={"Authorization": f"Bearer {seeded_user['token']}"},
        )
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["user_id"] == seeded_user["user_id"]
        assert u["email"] == seeded_user["email"]
        assert "_id" not in u


# ---------------- Auth enforcement ----------------
class TestAuthEnforcement:
    def test_get_deliveries_no_auth(self, base_url):
        r = requests.get(f"{base_url}/api/deliveries")
        assert r.status_code == 401

    def test_post_deliveries_no_auth(self, base_url):
        r = requests.post(f"{base_url}/api/deliveries", json={"address": "x", "lat": 0, "lon": 0})
        assert r.status_code == 401

    def test_put_profile_no_auth(self, base_url):
        r = requests.put(f"{base_url}/api/profile", json={"vehicle_size": "small"})
        assert r.status_code == 401

    def test_ocr_no_auth(self, base_url):
        r = requests.post(f"{base_url}/api/ocr/extract", json={"image_base64": "x"})
        assert r.status_code == 401


# ---------------- Deliveries CRUD ----------------
class TestDeliveriesCRUD:
    def test_list_empty(self, base_url, auth_headers):
        r = requests.get(f"{base_url}/api/deliveries", headers=auth_headers)
        assert r.status_code == 200
        assert r.json() == []

    def test_create_inside_ztl(self, base_url, auth_headers):
        payload = {
            "address": "TEST_Via Roma 1, Palermo",
            "lat": 38.117,
            "lon": 13.365,
            "recipient": "TEST_Mario",
        }
        r = requests.post(f"{base_url}/api/deliveries", headers=auth_headers, json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["in_ztl"] is True
        assert d["status"] == "pending"
        assert d["address"] == payload["address"]
        assert "id" in d
        # verify persistence
        r2 = requests.get(f"{base_url}/api/deliveries", headers=auth_headers)
        ids = [x["id"] for x in r2.json()]
        assert d["id"] in ids
        pytest.shared_inside_id = d["id"]

    def test_create_outside_ztl(self, base_url, auth_headers):
        payload = {
            "address": "TEST_Mondello",
            "lat": 38.200,
            "lon": 13.300,
            "recipient": "TEST_Luigi",
        }
        r = requests.post(f"{base_url}/api/deliveries", headers=auth_headers, json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["in_ztl"] is False
        pytest.shared_outside_id = d["id"]

    def test_update_status_done(self, base_url, auth_headers):
        did = pytest.shared_inside_id
        r = requests.put(
            f"{base_url}/api/deliveries/{did}",
            headers=auth_headers,
            json={"status": "done"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "done"
        # verify via GET
        r2 = requests.get(f"{base_url}/api/deliveries", headers=auth_headers)
        target = [x for x in r2.json() if x["id"] == did][0]
        assert target["status"] == "done"

    def test_delete(self, base_url, auth_headers):
        did = pytest.shared_outside_id
        r = requests.delete(f"{base_url}/api/deliveries/{did}", headers=auth_headers)
        assert r.status_code == 200
        # verify gone
        r2 = requests.get(f"{base_url}/api/deliveries", headers=auth_headers)
        ids = [x["id"] for x in r2.json()]
        assert did not in ids


# ---------------- Profile ----------------
class TestProfile:
    def test_update_profile(self, base_url, auth_headers):
        r = requests.put(
            f"{base_url}/api/profile",
            headers=auth_headers,
            json={"vehicle_size": "large", "ztl_pass": True},
        )
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["vehicle_size"] == "large"
        assert u["ztl_pass"] is True
        # verify via /me
        r2 = requests.get(f"{base_url}/api/auth/me", headers=auth_headers)
        u2 = r2.json()
        assert u2["vehicle_size"] == "large"
        assert u2["ztl_pass"] is True


# ---------------- OCR ----------------
class TestOCR:
    def test_ocr_with_tiny_image(self, base_url, auth_headers):
        # 1x1 transparent PNG
        png_b64 = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        )
        r = requests.post(
            f"{base_url}/api/ocr/extract",
            headers=auth_headers,
            json={"image_base64": png_b64},
            timeout=60,
        )
        # Must not be 500 — assertion: any non-5xx response is acceptable
        assert r.status_code < 500, f"OCR endpoint 5xx: {r.status_code} {r.text}"
        if r.status_code == 200:
            data = r.json()
            assert "address" in data
            assert "recipient" in data
            assert "raw" in data
