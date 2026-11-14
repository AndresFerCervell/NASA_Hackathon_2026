"""Genera efemérides locales del Sol y la Tierra desde un sitio lunar (basado en PRUEBAS.ipynb).

Ejecutar: python efemerides_lunar.py
"""
from __future__ import annotations

import argparse
from datetime import timedelta
import json
from pathlib import Path
import sys

import numpy as np
import pandas as pd

RAIZ_REPO = Path(__file__).resolve().parent
if str(RAIZ_REPO) not in sys.path:
    sys.path.insert(0, str(RAIZ_REPO))

from app.astronomy.lunar_geometry import calcular_desde_lugar
# ==============================================================================
# PARÁMETROS DE CONFIGURACIÓN (modifica estos valores antes de ejecutar)
# ==============================================================================
LUGAR = {
    "nombre": "Apolo 11",
    "latitud_deg": 0.67416,     # Norte positivo, sur negativo; [-90, 90].
    "longitud_deg": 23.47314,   # Este positivo, oeste negativo; [-180, 360].
    "altura_m": 0.0,            # Metros sobre la superficie de referencia de Horizons.
}
INICIO_UTC = "2026-11-14T12:00:00Z"
DURACION_HORAS = 24
PASO_HORAS = 1
DECIMALES = 4
SALIDA_JSON: Path | str | None = RAIZ_REPO / "efemerides.json"
# ==============================================================================


def _redondear_angulo(valor: float, decimales: int = DECIMALES) -> float | None:
    if pd.isna(valor) or not np.isfinite(valor):
        return None
    return round(float(valor), decimales)


def generar_efemerides(
    inicio_utc: str = INICIO_UTC,
    duracion: timedelta = timedelta(hours=DURACION_HORAS),
    paso: timedelta = timedelta(hours=PASO_HORAS),
    *,
    latitud_deg: float = LUGAR["latitud_deg"],
    longitud_deg: float = LUGAR["longitud_deg"],
    altura_m: float = LUGAR["altura_m"],
    nombre: str = LUGAR["nombre"],
    decimales: int = DECIMALES,
    salida: Path | str | None = None,
) -> dict:
    """Calcula la serie temporal desde un lugar lunar y devuelve el diccionario 'ephemeris'."""
    tabla = calcular_desde_lugar(
        inicio_utc,
        duracion,
        paso,
        latitud_deg=latitud_deg,
        longitud_deg=longitud_deg,
        altura_m=altura_m,
        nombre=nombre,
    )

    t0_ts = pd.Timestamp(tabla["tiempo_utc"].iloc[0]).tz_convert("UTC")
    t0_iso = t0_ts.strftime("%Y-%m-%dT%H:%M:%SZ")

    timeline = []
    for _, fila in tabla.iterrows():
        horas = float(fila["t_segundos"]) / 3600.0
        hora_offset: int | float = int(round(horas)) if np.isclose(horas, round(horas)) else round(horas, decimales)
        timeline.append(
            {
                "hora_offset": hora_offset,
                "sol_elevacion_deg": _redondear_angulo(fila["elevacion_sol_deg"], decimales),
                "sol_azimut_deg": _redondear_angulo(fila["acimut_sol_deg"], decimales),
                "tierra_elevacion_deg": _redondear_angulo(fila["elevacion_tierra_deg"], decimales),
                "tierra_azimut_deg": _redondear_angulo(fila["acimut_tierra_deg"], decimales),
            }
        )

    resultado = {
        "ephemeris": {
            "t0_aterrizaje": t0_iso,
            "timeline": timeline,
        }
    }

    if salida is not None:
        ruta = Path(salida)
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_text(
            json.dumps(resultado, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    return resultado


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nombre", default=LUGAR["nombre"], help="Nombre del sitio lunar")
    parser.add_argument("--lat", type=float, default=LUGAR["latitud_deg"], help="Latitud lunar en grados [-90, 90]")
    parser.add_argument("--lon", type=float, default=LUGAR["longitud_deg"], help="Longitud lunar en grados [-180, 360]")
    parser.add_argument("--altura-m", type=float, default=LUGAR["altura_m"], help="Altura en metros sobre ref. Horizons")
    parser.add_argument("--inicio", default=INICIO_UTC, help="Instante de aterrizaje t0 en UTC (ISO 8601)")
    parser.add_argument("--horas", type=float, default=DURACION_HORAS, help="Duración total en horas")
    parser.add_argument("--paso-horas", type=float, default=PASO_HORAS, help="Paso temporal en horas")
    parser.add_argument("--decimales", type=int, default=DECIMALES, help="Decimales de redondeo")
    parser.add_argument(
        "--salida",
        default=str(SALIDA_JSON) if SALIDA_JSON is not None else None,
        help="Archivo JSON de salida (usa '' para solo imprimir por pantalla)",
    )
    args = parser.parse_args()

    ruta_salida = args.salida if args.salida else None
    datos = generar_efemerides(
        inicio_utc=args.inicio,
        duracion=timedelta(hours=args.horas),
        paso=timedelta(hours=args.paso_horas),
        latitud_deg=args.lat,
        longitud_deg=args.lon,
        altura_m=args.altura_m,
        nombre=args.nombre,
        decimales=args.decimales,
        salida=ruta_salida,
    )
    print(json.dumps(datos, indent=2, ensure_ascii=False))
