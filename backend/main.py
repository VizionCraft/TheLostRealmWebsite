from __future__ import annotations

import hashlib
import hmac
import html
import json
import os
import re
import secrets
import smtplib
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Iterator

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field, field_validator

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

APP_SECRET = os.getenv("APP_SECRET", "").strip()
if not APP_SECRET or APP_SECRET == "replace-with-a-long-random-secret":
    raise RuntimeError("Set a long random APP_SECRET in backend/.env before starting the API.")

DB_PATH_VALUE = os.getenv("DB_PATH", "realm.db").strip() or "realm.db"
DB_PATH = Path(DB_PATH_VALUE)
if not DB_PATH.is_absolute():
    DB_PATH = BASE_DIR / DB_PATH

DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
SESSION_DAYS = max(1, int(os.getenv("SESSION_DAYS", "30")))
CODE_MINUTES = max(2, int(os.getenv("CODE_MINUTES", "10")))
LINK_CODE_MINUTES = max(2, int(os.getenv("LINK_CODE_MINUTES", "15")))
MAX_PLAYERS = max(1, int(os.getenv("WEBSITE_MAX_PLAYERS", "500")))
SERVER_HOST = os.getenv("MINECRAFT_SERVER_HOST", "127.0.0.1").strip()
SERVER_PORT = int(os.getenv("MINECRAFT_SERVER_PORT", "25565"))
LINK_API_SECRET = os.getenv("LINK_API_SECRET", "").strip()

SMTP_ENABLED = os.getenv("SMTP_ENABLED", "false").lower() == "true"
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").replace(" ", "").strip()
FROM_EMAIL = os.getenv("FROM_EMAIL", SMTP_USERNAME).strip()
FROM_NAME = os.getenv("FROM_NAME", "The Lost Realm").strip()

ADMIN_EMAILS = {
    value.strip().lower()
    for value in os.getenv("ADMIN_EMAILS", "").split(",")
    if value.strip()
}
ALLOWED_ORIGINS = [
    value.strip().rstrip("/")
    for value in os.getenv(
        "ALLOWED_ORIGINS",
        "http://127.0.0.1:5500,http://localhost:5500",
    ).split(",")
    if value.strip()
]

app = FastAPI(
    title="The Lost Realm API",
    version="2.0.0",
    description="Account, status, and website API for The Lost Realm.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Link-Secret"],
)

bearer = HTTPBearer(auto_error=False)
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
MINECRAFT_NAME_RE = re.compile(r"^[A-Za-z0-9_]{3,16}$")


class EmailRequest(BaseModel):
    email: EmailStr


class VerifyCodeRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        if not value.isdigit():
            raise ValueError("Code must contain six digits.")
        return value


class LinkAccountRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6)

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        if not value.isdigit():
            raise ValueError("Link code must contain six digits.")
        return value


class CreateLinkCodeRequest(BaseModel):
    minecraft_name: str = Field(min_length=3, max_length=16)
    minecraft_uuid: str = Field(min_length=32, max_length=36)

    @field_validator("minecraft_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not MINECRAFT_NAME_RE.fullmatch(value):
            raise ValueError("Minecraft names may contain letters, numbers, and underscores.")
        return value

    @field_validator("minecraft_uuid")
    @classmethod
    def validate_uuid(cls, value: str) -> str:
        cleaned = value.strip().lower()
        compact = cleaned.replace("-", "")
        if len(compact) != 32 or not all(char in "0123456789abcdef" for char in compact):
            raise ValueError("Minecraft UUID is invalid.")
        return cleaned


class DevLinkCodeRequest(BaseModel):
    minecraft_name: str = Field(min_length=3, max_length=16)
    minecraft_uuid: str | None = None

    @field_validator("minecraft_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not MINECRAFT_NAME_RE.fullmatch(value):
            raise ValueError("Minecraft names may contain letters, numbers, and underscores.")
        return value


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(DB_PATH, timeout=20)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def now_ts() -> int:
    return int(time.time())


def iso_time(timestamp: int | None) -> str | None:
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


def digest(value: str, purpose: str) -> str:
    key = APP_SECRET.encode("utf-8")
    message = f"{purpose}:{value}".encode("utf-8")
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if len(email) > 254 or not EMAIL_RE.fullmatch(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    return email


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                created_at INTEGER NOT NULL,
                last_login INTEGER,
                is_admin INTEGER NOT NULL DEFAULT 0,
                minecraft_uuid TEXT UNIQUE,
                minecraft_name TEXT UNIQUE COLLATE NOCASE,
                playtime_minutes INTEGER NOT NULL DEFAULT 0,
                quests_completed INTEGER NOT NULL DEFAULT 0,
                achievements INTEGER NOT NULL DEFAULT 0,
                friends INTEGER NOT NULL DEFAULT 0,
                playtime_rank TEXT NOT NULL DEFAULT 'Traveler',
                display_title TEXT NOT NULL DEFAULT 'Traveler'
            );

            CREATE TABLE IF NOT EXISTS verification_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL COLLATE NOCASE,
                code_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                used_at INTEGER,
                attempts INTEGER NOT NULL DEFAULT 0,
                request_ip TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_verification_email
            ON verification_codes(email, created_at DESC);

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                last_used_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS link_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code_hash TEXT NOT NULL UNIQUE,
                minecraft_uuid TEXT NOT NULL,
                minecraft_name TEXT NOT NULL COLLATE NOCASE,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                used_at INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_link_codes_created
            ON link_codes(created_at DESC);
            """
        )


@app.on_event("startup")
def startup() -> None:
    init_db()


def send_email(to_email: str, subject: str, text_body: str, html_body: str | None = None) -> None:
    if not SMTP_ENABLED:
        raise RuntimeError("SMTP is disabled.")
    if not all([SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, FROM_EMAIL]):
        raise RuntimeError("SMTP settings are incomplete.")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"{FROM_NAME} <{FROM_EMAIL}>"
    message["To"] = to_email
    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html")

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.ehlo()
        smtp.login(SMTP_USERNAME, SMTP_PASSWORD)
        smtp.send_message(message)


def send_sign_in_code(email: str, code: str) -> None:
    safe_code = html.escape(code)
    subject = f"{code} is your Lost Realm sign-in code"
    text = (
        "THE LOST REALM\n\n"
        f"Your one-time sign-in code is: {code}\n\n"
        f"This code expires in {CODE_MINUTES} minutes.\n"
        "If you did not request this code, you can ignore this email."
    )
    html_body = f"""
    <div style="background:#0d0a09;padding:32px;font-family:Arial,sans-serif;color:#f0eadf">
      <div style="max-width:560px;margin:auto;background:#191510;border:1px solid #6f5935;border-radius:18px;padding:32px">
        <p style="color:#e2b869;letter-spacing:3px;font-size:12px;font-weight:bold">THE LOST REALM</p>
        <h1 style="font-family:Georgia,serif;margin:8px 0 12px">Your sign-in code</h1>
        <p style="color:#bdb2a5">Use this one-time code to enter your player portal:</p>
        <div style="margin:24px 0;padding:18px;text-align:center;background:#0d0a09;border:1px solid #6f5935;border-radius:12px;font-size:34px;letter-spacing:10px;font-weight:bold;color:#f6dda2">{safe_code}</div>
        <p style="color:#aaa094">This code expires in {CODE_MINUTES} minutes. If you did not request it, you can safely ignore this email.</p>
      </div>
    </div>
    """
    send_email(email, subject, text, html_body)


def cleanup(connection: sqlite3.Connection) -> None:
    now = now_ts()
    connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
    connection.execute(
        "DELETE FROM verification_codes WHERE expires_at <= ? OR (used_at IS NOT NULL AND used_at < ?)",
        (now - 86400, now - 86400),
    )
    connection.execute(
        "DELETE FROM link_codes WHERE expires_at <= ? OR (used_at IS NOT NULL AND used_at < ?)",
        (now - 86400, now - 86400),
    )


def row_to_user(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "email": row["email"],
        "created_at": iso_time(row["created_at"]),
        "last_login": iso_time(row["last_login"]),
        "is_admin": bool(row["is_admin"]),
        "minecraft_uuid": row["minecraft_uuid"],
        "minecraft_name": row["minecraft_name"],
        "playtime_minutes": row["playtime_minutes"],
        "quests_completed": row["quests_completed"],
        "achievements": row["achievements"],
        "friends": row["friends"],
        "playtime_rank": row["playtime_rank"],
        "display_title": row["display_title"],
    }


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> sqlite3.Row:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in required.")

    token_hash = digest(credentials.credentials, "session")
    now = now_ts()
    with db() as connection:
        cleanup(connection)
        row = connection.execute(
            """
            SELECT users.*
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
            """,
            (token_hash, now),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired. Sign in again.")
        connection.execute(
            "UPDATE sessions SET last_used_at = ? WHERE token_hash = ?",
            (now, token_hash),
        )
        return row


def require_admin(user: sqlite3.Row = Depends(current_user)) -> sqlite3.Row:
    if not bool(user["is_admin"]):
        raise HTTPException(status_code=403, detail="Administrator access required.")
    return user


@app.get("/")
def root() -> dict[str, str]:
    return {"name": "The Lost Realm API", "version": "2.0.0", "status": "ready", "docs": "/docs"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy"}


@app.post("/api/auth/request-code")
def request_code(payload: EmailRequest, request: Request) -> dict[str, Any]:
    email = normalize_email(str(payload.email))
    now = now_ts()
    ip = client_ip(request)
    code = f"{secrets.randbelow(1_000_000):06d}"

    with db() as connection:
        cleanup(connection)
        last = connection.execute(
            "SELECT created_at FROM verification_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1",
            (email,),
        ).fetchone()
        if last and now - int(last["created_at"]) < 60:
            wait = 60 - (now - int(last["created_at"]))
            raise HTTPException(status_code=429, detail=f"Wait {wait} seconds before requesting another code.")

        recent_count = connection.execute(
            "SELECT COUNT(*) AS total FROM verification_codes WHERE email = ? AND created_at > ?",
            (email, now - 3600),
        ).fetchone()["total"]
        if recent_count >= 8:
            raise HTTPException(status_code=429, detail="Too many codes requested. Try again later.")

        connection.execute(
            "UPDATE verification_codes SET used_at = ? WHERE email = ? AND used_at IS NULL",
            (now, email),
        )
        connection.execute(
            """
            INSERT INTO verification_codes(email, code_hash, created_at, expires_at, request_ip)
            VALUES (?, ?, ?, ?, ?)
            """,
            (email, digest(f"{email}:{code}", "email-code"), now, now + CODE_MINUTES * 60, ip),
        )

    if SMTP_ENABLED:
        try:
            send_sign_in_code(email, code)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"The email could not be sent: {exc}") from exc
        return {"message": "A one-time code was sent to your email."}

    if DEMO_MODE:
        return {
            "message": "SMTP is disabled, so a development code was generated.",
            "dev_code": code,
        }

    raise HTTPException(status_code=503, detail="Email delivery is not configured.")


@app.post("/api/auth/verify-code")
def verify_code(payload: VerifyCodeRequest) -> dict[str, Any]:
    email = normalize_email(str(payload.email))
    now = now_ts()

    with db() as connection:
        cleanup(connection)
        record = connection.execute(
            """
            SELECT * FROM verification_codes
            WHERE email = ? AND used_at IS NULL
            ORDER BY created_at DESC LIMIT 1
            """,
            (email,),
        ).fetchone()

        if not record or int(record["expires_at"]) <= now:
            raise HTTPException(status_code=400, detail="That code expired. Request a new one.")
        if int(record["attempts"]) >= 5:
            raise HTTPException(status_code=429, detail="Too many incorrect attempts. Request a new code.")

        expected = record["code_hash"]
        supplied = digest(f"{email}:{payload.code}", "email-code")
        if not hmac.compare_digest(expected, supplied):
            connection.execute(
                "UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?",
                (record["id"],),
            )
            raise HTTPException(status_code=400, detail="That code is incorrect.")

        connection.execute("UPDATE verification_codes SET used_at = ? WHERE id = ?", (now, record["id"]))
        is_admin = 1 if email in ADMIN_EMAILS else 0
        user = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if user:
            connection.execute(
                "UPDATE users SET last_login = ?, is_admin = ? WHERE id = ?",
                (now, is_admin, user["id"]),
            )
            user_id = int(user["id"])
        else:
            cursor = connection.execute(
                "INSERT INTO users(email, created_at, last_login, is_admin) VALUES (?, ?, ?, ?)",
                (email, now, now, is_admin),
            )
            user_id = int(cursor.lastrowid)

        raw_token = secrets.token_urlsafe(48)
        connection.execute(
            """
            INSERT INTO sessions(user_id, token_hash, created_at, expires_at, last_used_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, digest(raw_token, "session"), now, now + SESSION_DAYS * 86400, now),
        )

    return {"message": "Signed in successfully.", "token": raw_token, "expires_in_days": SESSION_DAYS}


@app.post("/api/auth/logout")
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict[str, str]:
    if credentials:
        with db() as connection:
            connection.execute(
                "DELETE FROM sessions WHERE token_hash = ?",
                (digest(credentials.credentials, "session"),),
            )
    return {"message": "Logged out."}


@app.get("/api/me")
def me(user: sqlite3.Row = Depends(current_user)) -> dict[str, Any]:
    return row_to_user(user)


@app.delete("/api/account")
def delete_account(user: sqlite3.Row = Depends(current_user)) -> dict[str, str]:
    with db() as connection:
        connection.execute("DELETE FROM users WHERE id = ?", (user["id"],))
    return {"message": "Your Lost Realm website account was permanently deleted."}


@app.post("/api/account/request-data")
def request_data(user: sqlite3.Row = Depends(current_user)) -> dict[str, Any]:
    data = row_to_user(user)
    data["exported_at"] = iso_time(now_ts())
    pretty = json.dumps(data, indent=2)

    if SMTP_ENABLED:
        try:
            send_email(
                user["email"],
                "Your Lost Realm account data",
                "Here is the information currently stored for your Lost Realm website account:\n\n" + pretty,
                "<div style='font-family:Arial,sans-serif'><h2>Your Lost Realm account data</h2>"
                "<p>Below is the information currently stored for your website account.</p>"
                f"<pre style='background:#111;color:#eee;padding:16px;border-radius:10px;white-space:pre-wrap'>{html.escape(pretty)}</pre></div>",
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Your data was prepared, but the email failed: {exc}") from exc
        return {"message": "A copy of your account data was emailed to you."}

    if DEMO_MODE:
        return {"message": "SMTP is disabled. Your development data export is included in the API response.", "data": data}

    raise HTTPException(status_code=503, detail="Email delivery is not configured.")


@app.post("/api/account/link")
def link_account(payload: LinkAccountRequest, user: sqlite3.Row = Depends(current_user)) -> dict[str, str]:
    now = now_ts()
    code_hash = digest(payload.code, "link-code")

    with db() as connection:
        cleanup(connection)
        record = connection.execute(
            "SELECT * FROM link_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?",
            (code_hash, now),
        ).fetchone()
        if not record:
            raise HTTPException(status_code=400, detail="That Minecraft link code is invalid or expired.")

        existing = connection.execute(
            "SELECT id FROM users WHERE (minecraft_uuid = ? OR minecraft_name = ?) AND id <> ?",
            (record["minecraft_uuid"], record["minecraft_name"], user["id"]),
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="That Minecraft account is already linked to another website account.")

        connection.execute(
            "UPDATE users SET minecraft_uuid = ?, minecraft_name = ? WHERE id = ?",
            (record["minecraft_uuid"], record["minecraft_name"], user["id"]),
        )
        connection.execute("UPDATE link_codes SET used_at = ? WHERE id = ?", (now, record["id"]))

    return {"message": f"Minecraft account {record['minecraft_name']} was linked successfully."}


def create_link_code(minecraft_name: str, minecraft_uuid: str) -> dict[str, Any]:
    now = now_ts()
    code = f"{secrets.randbelow(1_000_000):06d}"
    with db() as connection:
        cleanup(connection)
        connection.execute(
            "UPDATE link_codes SET used_at = ? WHERE minecraft_uuid = ? AND used_at IS NULL",
            (now, minecraft_uuid),
        )
        connection.execute(
            """
            INSERT INTO link_codes(code_hash, minecraft_uuid, minecraft_name, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (digest(code, "link-code"), minecraft_uuid, minecraft_name, now, now + LINK_CODE_MINUTES * 60),
        )
    return {"code": code, "minecraft_name": minecraft_name, "expires_in_minutes": LINK_CODE_MINUTES}


@app.post("/api/minecraft/link-code")
def minecraft_link_code(
    payload: CreateLinkCodeRequest,
    x_link_secret: str | None = Header(default=None),
) -> dict[str, Any]:
    if not LINK_API_SECRET:
        raise HTTPException(status_code=503, detail="LINK_API_SECRET is not configured.")
    if not x_link_secret or not hmac.compare_digest(x_link_secret, LINK_API_SECRET):
        raise HTTPException(status_code=401, detail="Invalid Minecraft linking secret.")
    return create_link_code(payload.minecraft_name, payload.minecraft_uuid)


@app.post("/api/dev/link-code")
def development_link_code(payload: DevLinkCodeRequest) -> dict[str, Any]:
    if not DEMO_MODE:
        raise HTTPException(status_code=404, detail="Not found.")
    uuid_value = payload.minecraft_uuid or hashlib.md5(
        f"OfflinePlayer:{payload.minecraft_name}".encode("utf-8"), usedforsecurity=False
    ).hexdigest()
    return create_link_code(payload.minecraft_name, uuid_value)


@app.get("/api/admin/summary")
def admin_summary(admin: sqlite3.Row = Depends(require_admin)) -> dict[str, Any]:
    with db() as connection:
        total = connection.execute("SELECT COUNT(*) AS total FROM users").fetchone()["total"]
        linked = connection.execute("SELECT COUNT(*) AS total FROM users WHERE minecraft_uuid IS NOT NULL").fetchone()["total"]
        recent = connection.execute(
            "SELECT id, email, minecraft_name, created_at FROM users ORDER BY created_at DESC LIMIT 10"
        ).fetchall()
    return {
        "administrator": admin["email"],
        "total_accounts": total,
        "linked_accounts": linked,
        "recent_accounts": [
            {
                "id": row["id"],
                "email": row["email"],
                "minecraft_name": row["minecraft_name"],
                "created_at": iso_time(row["created_at"]),
            }
            for row in recent
        ],
    }


@app.get("/api/status")
def minecraft_status() -> dict[str, Any]:
    try:
        from mcstatus import JavaServer

        server = JavaServer.lookup(f"{SERVER_HOST}:{SERVER_PORT}")
        result = server.status()
        return {
            "online": True,
            "online_players": int(result.players.online),
            "max_players": int(result.players.max),
            "latency_ms": round(result.latency, 1),
            "host": SERVER_HOST,
        }
    except Exception:
        if DEMO_MODE:
            return {
                "online": True,
                "online_players": 42,
                "max_players": MAX_PLAYERS,
                "latency_ms": None,
                "host": SERVER_HOST,
                "demo": True,
            }
        return {
            "online": False,
            "online_players": 0,
            "max_players": MAX_PLAYERS,
            "latency_ms": None,
            "host": SERVER_HOST,
        }


@app.get("/api/news")
def news() -> dict[str, list[dict[str, Any]]]:
    return {
        "news": [
            {"id": 1, "headline": "The Lost Realm begins", "category": "Development Log", "summary": "The new website foundation is online."},
            {"id": 2, "headline": "Designing Hearthvale", "category": "Worldbuilding", "summary": "Planning the first village and tutorial area."},
        ]
    }


@app.get("/api/ranks")
def ranks() -> dict[str, list[dict[str, str]]]:
    return {
        "playtime": [
            {"name": "Traveler", "description": "The first step into the realm."},
            {"name": "Adventurer", "description": "For those who return to the road."},
            {"name": "Knight", "description": "A proven defender of the realm."},
            {"name": "Champion", "description": "A name remembered by the people."},
        ]
    }
