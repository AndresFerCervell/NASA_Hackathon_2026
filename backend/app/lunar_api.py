"""Validated frontend contract for lunar-site geometry."""
from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Annotated, Literal, Self

from fastapi import APIRouter, HTTPException
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.astronomy.lunar_geometry import (
    RADIO_TIERRA_KM,
    HorizonsError,
    HorizonsTimeout,
    calcular_desde_lugar,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Lunar geometry"])
# SSD requests are sequential, including between incoming frontend requests.
# Run one worker/instance, or replace with a distributed limiter before scaling.
_query_lock = Lock()
MAX_SAMPLES = 10000


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class LunarPlace(Contract):
    nombre: str = Field(default="Lugar lunar", min_length=1, max_length=100)
    latitud_deg: float = Field(ge=-90, le=90, strict=True)
    longitud_deg: float = Field(ge=-180, le=360, strict=True)
    altura_m: float = Field(default=0.0, ge=-20000, le=100000, strict=True)


class LunarGeometryRequest(Contract):
    lugar: LunarPlace
    inicio_utc: AwareDatetime
    duracion_segundos: int = Field(ge=0, le=366 * 86400, strict=True)
    paso_segundos: int = Field(ge=60, le=366 * 86400, multiple_of=60, strict=True)

    @field_validator("inicio_utc", mode="before")
    @classmethod
    def require_iso_datetime(cls, value: object) -> object:
        if not isinstance(value, (str, datetime)):
            raise ValueError("inicio_utc must be an ISO 8601 datetime with Z or an offset")
        return value

    @field_validator("inicio_utc")
    @classmethod
    def normalize_utc(cls, value: datetime) -> datetime:
        value = value.astimezone(timezone.utc)
        if value.microsecond or not 1962 <= value.year <= 2100:
            raise ValueError("Use whole UTC seconds and dates between 1962 and 2100")
        return value

    @model_validator(mode="after")
    def validate_interval(self) -> Self:
        if 0 < self.duracion_segundos < self.paso_segundos:
            raise ValueError("Duration must be zero or at least one sampling step")
        if self.duracion_segundos // self.paso_segundos + 1 > MAX_SAMPLES:
            raise ValueError(f"At most {MAX_SAMPLES} samples are allowed")
        if (self.inicio_utc + timedelta(seconds=self.duracion_segundos)).year > 2100:
            raise ValueError("The interval must end in or before 2100")
        return self


FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]


class LunarSample(Contract):
    tiempo_utc: datetime
    t_segundos: FiniteFloat
    tierra_x_km: FiniteFloat
    tierra_y_km: FiniteFloat
    tierra_z_km: FiniteFloat
    sol_x_km: FiniteFloat
    sol_y_km: FiniteFloat
    sol_z_km: FiniteFloat
    distancia_tierra_km: FiniteFloat
    distancia_sol_km: FiniteFloat
    elevacion_tierra_deg: FiniteFloat
    elevacion_sol_deg: FiniteFloat
    acimut_tierra_deg: FiniteFloat | None
    acimut_sol_deg: FiniteFloat | None
    angulo_normal_tierra_deg: FiniteFloat
    angulo_normal_sol_deg: FiniteFloat
    tierra_visible: bool
    conexion_tierra: bool
    sol_sobre_horizonte: bool
    tierra_bloquea_sol: bool
    iluminado_sin_terreno: bool
    iluminado: bool


class LunarGeometryResponse(Contract):
    lugar: LunarPlace
    inicio_utc: datetime
    duracion_segundos: int
    paso_segundos: int
    total_muestras: int
    fuente: Literal["JPL Horizons"] = "JPL Horizons"
    marco: Literal["ICRF"] = "ICRF"
    unidades: dict[str, str]
    modelo: dict[str, str | bool | float]
    datos: list[LunarSample]


@router.post(
    "/lunar-geometry",
    response_model=LunarGeometryResponse,
    responses={
        422: {"description": "Invalid place or time interval"},
        502: {"description": "Invalid response from JPL Horizons"},
        503: {"description": "Another Horizons query is running; retry later"},
        504: {"description": "JPL Horizons timed out"},
    },
)
def lunar_geometry(request: LunarGeometryRequest) -> LunarGeometryResponse:
    if not _query_lock.acquire(blocking=False):
        raise HTTPException(503, "A Horizons query is already running", headers={"Retry-After": "5"})
    try:
        table = calcular_desde_lugar(
            request.inicio_utc,
            timedelta(seconds=request.duracion_segundos),
            timedelta(seconds=request.paso_segundos),
            **request.lugar.model_dump(),
        )
    except HorizonsTimeout as error:
        logger.warning("JPL Horizons query timed out: %s", error)
        raise HTTPException(504, "JPL Horizons timed out; retry later") from error
    except HorizonsError as error:
        logger.warning("JPL Horizons query failed: %s", error)
        raise HTTPException(502, "JPL Horizons could not provide valid ephemerides") from error
    finally:
        _query_lock.release()

    # JSON has no NaN. Undefined azimuth at a pole or zenith/nadir is null.
    rows = table.to_dict(orient="records")
    for row in rows:
        for name in ("acimut_tierra_deg", "acimut_sol_deg"):
            if not math.isfinite(row[name]):
                row[name] = None
    return LunarGeometryResponse(
        lugar=request.lugar,
        inicio_utc=request.inicio_utc,
        duracion_segundos=request.duracion_segundos,
        paso_segundos=request.paso_segundos,
        total_muestras=len(rows),
        unidades={"posiciones_distancias": "km", "angulos": "deg", "altura": "m", "tiempo": "UTC"},
        modelo={
            "posiciones": "instantaneous geometric vectors from the lunar site to body centers",
            "acimut": "clockwise from lunar north: N=0, E=90, S=180, W=270",
            "elevacion": "above the local horizontal; theta = 90 - elevation",
            "datum_lunar": "Horizons lunar Mean Earth reference surface",
            "radio_tierra_km": RADIO_TIERRA_KM,
            "terreno_incluido": False,
            "sol_puntual": True,
            "horizonte": "local horizontal; no altitude horizon dip",
            "conexion": "Earth center above local horizontal, not a specific ground station",
        },
        datos=[LunarSample.model_validate(row) for row in rows],
    )
