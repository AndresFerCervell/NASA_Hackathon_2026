"""FastAPI entrypoint for the J2000.0 Sun-Earth-Moon ephemeris backend."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from app.lunar_api import router as lunar_router

from app.astronomy.ephemeris import (
    clamp_or_wrap_jd,
    compute_julian_date,
    compute_orbital_mechanics_from_jd,
    compute_trajectory_range,
    jd_to_calendar_utc,
)

app = FastAPI(title="J2000.0 Ephemeris API", version="1.0.0")
app.include_router(lunar_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://localhost:3000"
    ).split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "ephemeris-backend-python",
        "kernel": "de440s.bsp",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/ephemeris")
def get_ephemeris(
    jd: float | None = Query(default=None),
    year: int = Query(default=2026, ge=1900, le=2100),
    month: int = Query(default=11, ge=1, le=12),
    day: int = Query(default=14, ge=1, le=31),
    hour: float = Query(default=10.67, ge=0.0, lt=24.0),
) -> dict[str, object]:
    target_jd = (
        clamp_or_wrap_jd(jd)
        if jd is not None
        else clamp_or_wrap_jd(compute_julian_date(year, month, day, hour))
    )
    calendar = jd_to_calendar_utc(target_jd)
    telemetry = compute_orbital_mechanics_from_jd(target_jd)
    return {
        "calendar": asdict(calendar),
        "telemetry": asdict(telemetry),
    }


@app.get("/api/trajectory")
def get_trajectory(
    jd: float = Query(...),
    days: float = Query(default=29.53, gt=0.0, le=3660.0),
    steps: int = Query(default=60, ge=2, le=365),
) -> dict[str, object]:
    if not (-1e9 < jd < 1e9):
        raise HTTPException(status_code=400, detail="Invalid Julian Date.")
    points = compute_trajectory_range(jd, days, steps)
    return {
        "startJD": jd,
        "days": days,
        "steps": len(points),
        "points": points,
    }
