from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

app = FastAPI(
    title="The Lost Realm API",
    version="1.0.0",
    description="Development API for The Lost Realm website.",
)

origins = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://127.0.0.1:5500,http://localhost:5500",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

SERVER_HOST = os.getenv("MINECRAFT_SERVER_HOST", "127.0.0.1")
SERVER_PORT = int(os.getenv("MINECRAFT_SERVER_PORT", "25565"))
MAX_PLAYERS = int(os.getenv("WEBSITE_MAX_PLAYERS", "500"))
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"


@app.get("/")
def root() -> dict[str, str]:
    return {
        "name": "The Lost Realm API",
        "status": "ready",
        "docs": "/docs",
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy"}


@app.get("/api/status")
def minecraft_status() -> dict[str, Any]:
    """
    Attempts a real Minecraft status lookup when mcstatus is available.
    Falls back to development demo data when DEMO_MODE=true.
    """
    try:
        from mcstatus import JavaServer

        server = JavaServer.lookup(f"{SERVER_HOST}:{SERVER_PORT}")
        status = server.status()

        return {
            "online": True,
            "online_players": int(status.players.online),
            "max_players": int(status.players.max),
            "latency_ms": round(status.latency, 1),
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
            {
                "id": 1,
                "headline": "The Lost Realm begins",
                "category": "Development Log",
                "summary": "The new website foundation is online.",
            },
            {
                "id": 2,
                "headline": "Designing Hearthvale",
                "category": "Worldbuilding",
                "summary": "Planning the first village and tutorial area.",
            },
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
