"""FastAPI entrypoint for the J2000.0 Sun-Earth-Moon ephemeris backend."""

from __future__ import annotations

import os
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
import sys

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from app.lunar_api import router as lunar_router

_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from evaluar import procesar_peticion_frontend  # noqa: E402

from app.astronomy.ephemeris import (
    CURATED_SITES,
    clamp_or_wrap_jd,
    compute_julian_date,
    compute_orbital_mechanics_from_jd,
    compute_trajectory_range,
    evaluate_landing_site_viability,
    jd_to_calendar_utc,
)

app = FastAPI(title="J2000.0 Ephemeris API", version="1.0.0")
app.include_router(lunar_router)

_raw_cors_origins = os.getenv("CORS_ORIGINS", "*").strip()
_cors_origins = (
    ["*"]
    if _raw_cors_origins == "*"
    else [origin.strip() for origin in _raw_cors_origins.split(",") if origin.strip()]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_cors_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
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


def _map_evaluacion_to_response(
    site_eval: dict[str, object], fallback_name: str
) -> dict[str, object]:
    name = str(site_eval.get("nombre") or fallback_name)
    viable = site_eval.get("viable") is True
    fallos = [int(c) for c in (site_eval.get("fallos") or [])]
    metricas = site_eval.get("datos_tecnicos") or {}
    pendiente = metricas.get("pendiente_evaluada_deg")
    pct_luz = metricas.get("porcentaje_luz")

    if viable:
        pct_str = f"{float(pct_luz):.1f}% lit" if isinstance(pct_luz, (int, float)) else "lit"
        slope_str = f"slope {float(pendiente):.1f}°" if isinstance(pendiente, (int, float)) else "terrain OK"
        return {
            "name": name,
            "funciona": True,
            "tipo_despegue": f"Viable ({pct_str}, {slope_str})",
            "tipo_fallo": "None",
            "evaluacion": site_eval,
        }

    no_slope = 1 in fallos
    no_sun = any(c in fallos for c in (3, 5, 6))
    no_comms = 4 in fallos

    if no_slope:
        slope_str = f" ({float(pendiente):.1f}°)" if isinstance(pendiente, (int, float)) else ""
        tipo_despegue = "Not viable (unsafe terrain)"
        tipo_fallo = f"Terrain slope too steep{slope_str}"
    elif no_sun and no_comms:
        tipo_despegue = "Not viable"
        tipo_fallo = "No solar illumination and no direct Earth link"
    elif no_comms:
        tipo_despegue = "Partial (relay required)"
        tipo_fallo = "No direct line of sight to Earth"
    elif no_sun:
        tipo_despegue = "Not viable (wait for lunar sunrise)"
        tipo_fallo = "No solar illumination"
    else:
        tipo_despegue = "Not viable"
        tipo_fallo = str(site_eval.get("mensaje_tecnico") or "Evaluation failed")

    return {
        "name": name,
        "funciona": False,
        "tipo_despegue": tipo_despegue,
        "tipo_fallo": tipo_fallo,
        "evaluacion": site_eval,
    }


@app.get("/api/landing_site_viability")
def landing_site_viability(
    landing_site: str = Query(default="custom"),
    fecha: str | None = Query(default=None),
    lat: float | None = Query(default=None, ge=-90.0, le=90.0),
    lon: float | None = Query(default=None, ge=-180.0, le=180.0),
    name: str | None = Query(default=None),
) -> dict[str, object]:
    preset = CURATED_SITES.get(landing_site)
    resolved_name = name or (str(preset["name"]) if preset else landing_site)
    resolved_lat = lat if lat is not None else (float(preset["lat"]) if preset else -85.0)
    resolved_lon = lon if lon is not None else (float(preset["lon"]) if preset else 0.0)

    if fecha:
        dt = datetime.fromisoformat(fecha.replace("Z", "+00:00")).astimezone(timezone.utc)
    else:
        dt = datetime.now(timezone.utc)
    dt = dt.replace(microsecond=0)

    if dt.year < 1962:
        return evaluate_landing_site_viability(
            landing_site=landing_site,
            fecha_iso=dt.isoformat(),
            lat_deg=resolved_lat,
            lon_deg=resolved_lon,
            site_name=resolved_name,
        )

    try:
        resultado = procesar_peticion_frontend(
            tiempo=dt,
            latitud=resolved_lat,
            longitud=resolved_lon,
            nombre=resolved_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    evaluacion_dict = resultado.get("evaluacion") or {}
    site_eval = next(iter(evaluacion_dict.values()), {})
    return _map_evaluacion_to_response(site_eval, resolved_name)
