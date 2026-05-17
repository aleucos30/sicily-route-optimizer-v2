from fastapi import FastAPI, APIRouter, HTTPException, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import random
import string
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Tuple
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ---------- Palermo ZTL Centro Storico polygon ----------
PALERMO_ZTL_POLYGON: List[Tuple[float, float]] = [
    (13.3580, 38.1240), (13.3635, 38.1245), (13.3690, 38.1250),
    (13.3745, 38.1225), (13.3760, 38.1190), (13.3735, 38.1135),
    (13.3675, 38.1115), (13.3605, 38.1120), (13.3570, 38.1160),
    (13.3565, 38.1200), (13.3580, 38.1240),
]


def point_in_polygon(lon: float, lat: float, poly: List[Tuple[float, float]]) -> bool:
    n = len(poly)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        intersect = ((yi > lat) != (yj > lat)) and (
            lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersect:
            inside = not inside
        j = i
    return inside


def haversine_km(a_lat, a_lon, b_lat, b_lon):
    from math import radians, sin, cos, sqrt, atan2
    R = 6371.0
    dlat = radians(b_lat - a_lat)
    dlon = radians(b_lon - a_lon)
    h = sin(dlat / 2) ** 2 + cos(radians(a_lat)) * cos(radians(b_lat)) * sin(dlon / 2) ** 2
    return 2 * R * atan2(sqrt(h), sqrt(1 - h))


def generate_invite_code() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


# ---------- Models ----------
class SessionRequest(BaseModel):
    session_id: str


class ProfileUpdate(BaseModel):
    vehicle_size: Optional[str] = None
    ztl_pass: Optional[bool] = None


class RoleSet(BaseModel):
    role: str  # private | employee | company


class RoleSwitch(BaseModel):
    role: str  # private | employee | company


class MessageCreate(BaseModel):
    to_user_id: str
    text: str


class CompanySetup(BaseModel):
    company_name: str


class CompanyJoin(BaseModel):
    invite_code: str


class LocationPing(BaseModel):
    lat: float
    lon: float


class DeliveryCreate(BaseModel):
    address: str
    lat: float
    lon: float
    recipient: Optional[str] = None
    notes: Optional[str] = None


class DeliveryUpdate(BaseModel):
    status: Optional[str] = None


class OCRRequest(BaseModel):
    image_base64: str


class RouteOptimizeRequest(BaseModel):
    start_lat: float
    start_lon: float


# ---------- Auth helper ----------
async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1]
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    exp = session.get("expires_at")
    if isinstance(exp, datetime):
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ---------- Auth routes ----------
@api_router.post("/auth/session")
async def create_session(body: SessionRequest):
    async with httpx.AsyncClient(timeout=15.0) as hc:
        r = await hc.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": body.session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()
    email = data["email"]
    name = data.get("name", email)
    picture = data.get("picture")
    session_token = data["session_token"]

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "vehicle_size": "medium",
            "ztl_pass": False,
            "role": None,
            "company_id": None,
            "language": "it",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"session_token": session_token, "user": user}


@api_router.get("/auth/me")
async def auth_me(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if user.get("company_id"):
        company = await db.companies.find_one({"company_id": user["company_id"]}, {"_id": 0})
        user["company"] = company
    return user


@api_router.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------- Onboarding / Role ----------
@api_router.post("/onboarding/role")
async def set_role(body: RoleSet, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if body.role not in ("private", "employee", "company"):
        raise HTTPException(400, "Invalid role")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"role": body.role}})
    user = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return user


@api_router.post("/profile/switch-role")
async def switch_role(body: RoleSwitch, authorization: Optional[str] = Header(None)):
    """Switch account type. Resets company_id so user must re-onboard."""
    user = await get_current_user(authorization)
    if body.role not in ("private", "employee", "company"):
        raise HTTPException(400, "Invalid role")

    updates: dict = {"role": body.role}

    # Leaving a company (employee or company owner)
    old_role = user.get("role")
    old_company_id = user.get("company_id")

    if old_role == "company" and old_company_id and body.role != "company":
        # The company owner leaves -> delete the company so its invite code is invalidated
        await db.companies.delete_many({"company_id": old_company_id, "owner_id": user["user_id"]})
        # Employees that were in this company lose their link
        await db.users.update_many(
            {"company_id": old_company_id, "user_id": {"$ne": user["user_id"]}},
            {"$set": {"company_id": None}},
        )
        updates["company_id"] = None
    elif old_role == "employee" and body.role != "employee":
        # Leaving as employee
        updates["company_id"] = None
    elif body.role == "company" and old_company_id is None:
        updates["company_id"] = None
    elif body.role == "employee":
        # Must re-join, clear company link
        updates["company_id"] = None

    await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    user = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if user.get("company_id"):
        user["company"] = await db.companies.find_one({"company_id": user["company_id"]}, {"_id": 0})
    return user


@api_router.post("/company/setup")
async def company_setup(body: CompanySetup, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if user.get("role") != "company":
        raise HTTPException(403, "Only company role can create a company")
    if user.get("company_id"):
        existing = await db.companies.find_one({"company_id": user["company_id"]}, {"_id": 0})
        if existing:
            return existing
    # Generate unique invite code
    code = generate_invite_code()
    while await db.companies.find_one({"invite_code": code}):
        code = generate_invite_code()
    company_id = f"co_{uuid.uuid4().hex[:10]}"
    company = {
        "company_id": company_id,
        "name": body.company_name.strip(),
        "invite_code": code,
        "owner_id": user["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.companies.insert_one(company.copy())
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"company_id": company_id}})
    return company


@api_router.post("/company/join")
async def company_join(body: CompanyJoin, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if user.get("role") != "employee":
        raise HTTPException(403, "Only employee role can join a company")
    company = await db.companies.find_one({"invite_code": body.invite_code.strip().upper()}, {"_id": 0})
    if not company:
        raise HTTPException(404, "Codice invito non valido")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"company_id": company["company_id"]}})
    return company


@api_router.get("/company/employees")
async def company_employees(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if user.get("role") != "company" or not user.get("company_id"):
        raise HTTPException(403, "Only the company owner can list employees")
    cursor = db.users.find(
        {"company_id": user["company_id"], "role": "employee"},
        {"_id": 0, "email": 1, "name": 1, "user_id": 1, "picture": 1,
         "vehicle_size": 1, "ztl_pass": 1, "last_lat": 1, "last_lon": 1, "last_seen": 1},
    )
    employees = await cursor.to_list(500)
    # Attach delivery summary
    out = []
    for emp in employees:
        deliveries = await db.deliveries.find(
            {"user_id": emp["user_id"]}, {"_id": 0}
        ).to_list(500)
        total = len(deliveries)
        done = sum(1 for d in deliveries if d.get("status") == "done")
        ztl_warn = sum(1 for d in deliveries if d.get("in_ztl") and not emp.get("ztl_pass"))
        out.append({
            **emp,
            "deliveries": deliveries,
            "summary": {
                "total": total,
                "done": done,
                "pending": total - done,
                "ztl_warnings": ztl_warn,
                "completion_pct": round((done / total) * 100) if total else 0,
            },
        })
    return out


# ---------- Profile ----------
@api_router.put("/profile")
async def update_profile(body: ProfileUpdate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if updates:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    user = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return user


# ---------- Location ----------
@api_router.post("/location/ping")
async def location_ping(body: LocationPing, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "last_lat": body.lat,
            "last_lon": body.lon,
            "last_seen": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"ok": True}


# ---------- Geocode (Italy-wide) ----------
@api_router.get("/geocode/search")
async def geocode_search(q: str):
    if not q or len(q) < 3:
        return []
    params = {
        "q": q,
        "format": "json",
        "addressdetails": 1,
        "limit": 8,
        "countrycodes": "it",
    }
    async with httpx.AsyncClient(timeout=10.0) as hc:
        r = await hc.get(
            "https://nominatim.openstreetmap.org/search",
            params=params,
            headers={"User-Agent": "SpeedyMap/1.0 (delivery-app)"}
        )
    if r.status_code != 200:
        return []
    results = r.json()
    return [{
        "display_name": item.get("display_name"),
        "lat": float(item.get("lat")),
        "lon": float(item.get("lon")),
        "address": item.get("address", {}),
    } for item in results]


# ---------- ZTL ----------
@api_router.get("/ztl/check")
async def ztl_check(lat: float, lon: float):
    return {"in_ztl": point_in_polygon(lon, lat, PALERMO_ZTL_POLYGON)}


@api_router.get("/ztl/polygon")
async def ztl_polygon():
    return {"polygon": [{"latitude": lat, "longitude": lon} for (lon, lat) in PALERMO_ZTL_POLYGON]}


# ---------- Deliveries ----------
@api_router.get("/deliveries")
async def list_deliveries(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    cursor = db.deliveries.find({"user_id": user["user_id"]}, {"_id": 0}).sort("order_index", 1)
    items = await cursor.to_list(500)
    return items


@api_router.post("/deliveries")
async def create_delivery(body: DeliveryCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    in_ztl = point_in_polygon(body.lon, body.lat, PALERMO_ZTL_POLYGON)
    # next order index
    last = await db.deliveries.find_one(
        {"user_id": user["user_id"]}, sort=[("order_index", -1)], projection={"_id": 0, "order_index": 1}
    )
    next_idx = (last.get("order_index", 0) + 1) if last else 1
    delivery = {
        "id": f"d_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "address": body.address,
        "lat": body.lat,
        "lon": body.lon,
        "recipient": body.recipient,
        "notes": body.notes,
        "in_ztl": in_ztl,
        "status": "pending",
        "order_index": next_idx,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.deliveries.insert_one(delivery.copy())
    return delivery


@api_router.put("/deliveries/{delivery_id}")
async def update_delivery(delivery_id: str, body: DeliveryUpdate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if updates:
        await db.deliveries.update_one(
            {"id": delivery_id, "user_id": user["user_id"]},
            {"$set": updates},
        )
    d = await db.deliveries.find_one({"id": delivery_id, "user_id": user["user_id"]}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Not found")
    return d


@api_router.delete("/deliveries/{delivery_id}")
async def delete_delivery(delivery_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await db.deliveries.delete_one({"id": delivery_id, "user_id": user["user_id"]})
    return {"ok": True}


# ---------- Route Optimization ----------
@api_router.post("/route/optimize")
async def route_optimize(body: RouteOptimizeRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    pending = await db.deliveries.find(
        {"user_id": user["user_id"], "status": {"$ne": "done"}}, {"_id": 0}
    ).to_list(500)
    if not pending:
        return {"order": [], "polyline": [], "distance_km": 0, "duration_min": 0}

    # Nearest-neighbor ordering
    remaining = list(pending)
    ordered = []
    cur_lat, cur_lon = body.start_lat, body.start_lon
    while remaining:
        idx = min(
            range(len(remaining)),
            key=lambda i: haversine_km(cur_lat, cur_lon, remaining[i]["lat"], remaining[i]["lon"]),
        )
        nxt = remaining.pop(idx)
        ordered.append(nxt)
        cur_lat, cur_lon = nxt["lat"], nxt["lon"]

    # Persist new order_index
    for i, d in enumerate(ordered, start=1):
        await db.deliveries.update_one(
            {"id": d["id"], "user_id": user["user_id"]},
            {"$set": {"order_index": i}},
        )

    # Build OSRM request (start + ordered stops)
    coords = [f"{body.start_lon},{body.start_lat}"] + [f"{d['lon']},{d['lat']}" for d in ordered]
    osrm_url = f"https://router.project-osrm.org/route/v1/driving/{';'.join(coords)}"
    polyline_coords: List[List[float]] = []
    distance_km = 0.0
    duration_min = 0.0
    try:
        async with httpx.AsyncClient(timeout=20.0) as hc:
            r = await hc.get(osrm_url, params={"overview": "full", "geometries": "geojson"})
        if r.status_code == 200:
            j = r.json()
            if j.get("routes"):
                route = j["routes"][0]
                # GeoJSON: [[lon,lat], ...] -> convert to [lat, lon] for Leaflet
                polyline_coords = [[c[1], c[0]] for c in route["geometry"]["coordinates"]]
                distance_km = round(route["distance"] / 1000, 2)
                duration_min = round(route["duration"] / 60, 1)
    except Exception as e:
        logging.warning(f"OSRM failed: {e}")

    return {
        "order": [{"id": d["id"], "address": d["address"], "lat": d["lat"], "lon": d["lon"], "in_ztl": d["in_ztl"]} for d in ordered],
        "polyline": polyline_coords,
        "distance_km": distance_km,
        "duration_min": duration_min,
        "start": {"lat": body.start_lat, "lon": body.start_lon},
    }


# ---------- OCR ----------
@api_router.post("/ocr/extract")
async def ocr_extract(body: OCRRequest, authorization: Optional[str] = Header(None)):
    await get_current_user(authorization)
    if not EMERGENT_LLM_KEY:
        raise HTTPException(500, "LLM key not configured")

    img_b64 = body.image_base64
    if img_b64.startswith("data:"):
        img_b64 = img_b64.split(",", 1)[1]

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"ocr_{uuid.uuid4().hex[:8]}",
            system_message=(
                "Estrai i dati dell'indirizzo di spedizione da foto di etichette. "
                "Rispondi con JSON STRETTO con chiavi: address (via, numero, città, CAP, paese), "
                "recipient (persona/azienda se visibile, altrimenti null). "
                "RISPONDI SOLO con l'oggetto JSON, nessun markdown."
            ),
        ).with_model("openai", "gpt-4o")

        image = ImageContent(image_base64=img_b64)
        msg = UserMessage(
            text="Estrai l'indirizzo di spedizione dall'etichetta. Restituisci solo JSON.",
            file_contents=[image],
        )
        response = await chat.send_message(msg)
        text = (response or "").strip()

        import json
        import re
        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        parsed = {}
        if json_match:
            try:
                parsed = json.loads(json_match.group(0))
            except Exception:
                parsed = {}
        return {
            "address": parsed.get("address") or text,
            "recipient": parsed.get("recipient"),
            "raw": text,
        }
    except Exception as e:
        logging.exception("OCR failed")
        raise HTTPException(500, f"OCR failed: {str(e)}")


# ---------- Chat / Messages ----------
@api_router.post("/messages")
async def send_message(body: MessageCreate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if not body.text.strip():
        raise HTTPException(400, "Empty message")

    other = await db.users.find_one({"user_id": body.to_user_id}, {"_id": 0})
    if not other:
        raise HTTPException(404, "Recipient not found")

    # Authorization rule: company<->employees in same company only
    company_id = user.get("company_id")
    if not company_id or other.get("company_id") != company_id:
        raise HTTPException(403, "Only employees and the company can chat with each other")
    if user["user_id"] == other["user_id"]:
        raise HTTPException(400, "Cannot message yourself")

    msg = {
        "id": f"m_{uuid.uuid4().hex[:12]}",
        "company_id": company_id,
        "from_user_id": user["user_id"],
        "to_user_id": body.to_user_id,
        "text": body.text.strip(),
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.messages.insert_one(msg.copy())
    return msg


@api_router.get("/messages")
async def list_messages(with_user: str, authorization: Optional[str] = Header(None)):
    """Get the conversation between the current user and `with_user`."""
    user = await get_current_user(authorization)
    other = await db.users.find_one({"user_id": with_user}, {"_id": 0})
    if not other:
        raise HTTPException(404, "User not found")
    company_id = user.get("company_id")
    if not company_id or other.get("company_id") != company_id:
        raise HTTPException(403, "Cannot view this conversation")

    cursor = db.messages.find(
        {
            "company_id": company_id,
            "$or": [
                {"from_user_id": user["user_id"], "to_user_id": with_user},
                {"from_user_id": with_user, "to_user_id": user["user_id"]},
            ],
        },
        {"_id": 0},
    ).sort("created_at", 1)
    msgs = await cursor.to_list(500)

    # Mark received-by-me messages as read
    await db.messages.update_many(
        {"company_id": company_id, "from_user_id": with_user, "to_user_id": user["user_id"], "read": False},
        {"$set": {"read": True}},
    )
    return msgs


@api_router.get("/messages/threads")
async def list_threads(authorization: Optional[str] = Header(None)):
    """For company: list of employees with last message + unread count.
       For employee: just the company owner thread."""
    user = await get_current_user(authorization)
    company_id = user.get("company_id")
    if not company_id:
        return []

    if user.get("role") == "company":
        peers = await db.users.find(
            {"company_id": company_id, "role": "employee"},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1, "picture": 1},
        ).to_list(500)
    else:
        company = await db.companies.find_one({"company_id": company_id}, {"_id": 0})
        if not company:
            return []
        owner = await db.users.find_one(
            {"user_id": company["owner_id"]},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1, "picture": 1},
        )
        peers = [owner] if owner else []

    out = []
    for p in peers:
        last = await db.messages.find_one(
            {
                "company_id": company_id,
                "$or": [
                    {"from_user_id": user["user_id"], "to_user_id": p["user_id"]},
                    {"from_user_id": p["user_id"], "to_user_id": user["user_id"]},
                ],
            },
            {"_id": 0},
            sort=[("created_at", -1)],
        )
        unread = await db.messages.count_documents(
            {
                "company_id": company_id,
                "from_user_id": p["user_id"],
                "to_user_id": user["user_id"],
                "read": False,
            }
        )
        out.append({
            "peer": p,
            "last_message": last,
            "unread": unread,
        })
    # Sort: unread first, then by last message time
    out.sort(key=lambda x: (
        -x["unread"],
        -(datetime.fromisoformat(x["last_message"]["created_at"].replace("Z", "+00:00")).timestamp() if x["last_message"] else 0)
    ))
    return out


# ---------- Root ----------
@api_router.get("/")
async def root():
    return {"message": "SpeedyMap API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.deliveries.create_index("user_id")
    await db.companies.create_index("company_id", unique=True)
    await db.companies.create_index("invite_code", unique=True)
    await db.messages.create_index([("company_id", 1), ("from_user_id", 1), ("to_user_id", 1), ("created_at", 1)])


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

# --- NUOVE ROTTE EMAIL/PASSWORD ---
import hashlib
from pydantic import BaseModel

class UserAuth(BaseModel):
    email: str
    password: str

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

@api_router.post("/register")
async def register_user(user: UserAuth):
    existing = await db.users.find_one({"email": user.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email già registrata.")
    
    user_dict = {
        "email": user.email, 
        "password": hash_password(user.password), 
        "role": "driver",
        "created_at": datetime.now(timezone.utc)
    }
    await db.users.insert_one(user_dict)
    return {"message": "Registrazione completata!"}

@api_router.post("/login")
async def login_user(user: UserAuth):
    existing = await db.users.find_one({"email": user.email})
    if not existing or existing.get("password") != hash_password(user.password):
        raise HTTPException(status_code=401, detail="Credenziali errate.")
    
    return {
        "message": "Accesso eseguito!", 
        "email": existing["email"], 
        "role": existing.get("role", "driver")
    }
