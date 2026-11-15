"""Calcula terreno, efemérides y viabilidad; conserva la última petición.

Ejemplo desde backend:
    python evaluar.py --tiempo 2026-11-14T12:00:00Z --lat -89.65 --lon 129.2 --horas 336
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timedelta
import json
import math
import os
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
from uuid import uuid4

import pandas as pd

from app.terrain import calcular_terreno
from app.astronomy.lunar_geometry import DECIMALES, DURACION_HORAS, PASO_HORAS, generar_efemerides
from app.evaluation import LandingSiteEvaluator

CARPETA_BACKEND = Path(__file__).resolve().parent
CARPETA_SALIDA = CARPETA_BACKEND / "results"
TIEMPO_DEFAULT = "2026-11-14T12:00:00Z"
LATITUD_DEFAULT = -89.65
LONGITUD_DEFAULT = 129.2
NOMBRES_ARCHIVOS = {"terreno": "terreno.json", "efemerides": "efemerides.json",
                    "combinado": "datos_lunares.json", "evaluacion": "evaluacion.json"}


@contextmanager
def _salida_peticion(carpeta_salida):
    """Limpia los resultados previos con exclusión entre hilos y procesos."""
    if carpeta_salida is None:
        yield None
        return

    raiz = Path(carpeta_salida).resolve()
    raiz.mkdir(parents=True, exist_ok=True)
    # Permanece para que todos los procesos bloqueen el mismo fichero.
    with (raiz / ".peticion.lock").open("a+b") as bloqueo:
        if os.name == "nt":
            import msvcrt
            if bloqueo.tell() == 0:
                bloqueo.write(b"\0")
                bloqueo.flush()
            bloqueo.seek(0)
        else:
            import fcntl
        try:
            if os.name == "nt":
                msvcrt.locking(bloqueo.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                fcntl.flock(bloqueo.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise RuntimeError("Ya hay una petición en curso en esta carpeta de salida.") from error
        try:
            for anterior in raiz.iterdir():
                es_carpeta = anterior.name.startswith(("peticion_", ".incompleta-"))
                if anterior.name in NOMBRES_ARCHIVOS.values() or es_carpeta:
                    if anterior.resolve().parent != raiz or anterior.is_symlink():
                        raise ValueError("La limpieza debe permanecer dentro de la carpeta de salida.")
                    if anterior.is_dir():
                        shutil.rmtree(anterior)
                    else:
                        anterior.unlink()
            yield raiz
        finally:
            bloqueo.seek(0)
            if os.name == "nt":
                msvcrt.locking(bloqueo.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(bloqueo.fileno(), fcntl.LOCK_UN)


def procesar_peticion_frontend(
    tiempo: str | datetime, latitud: float, longitud: float, *,
    duracion_horas: float = DURACION_HORAS, paso_horas: float = PASO_HORAS,
    carpeta_salida: Path | str | None = CARPETA_SALIDA,
    nombre: str = "Sitio lunar", evaluador: LandingSiteEvaluator | None = None,
) -> dict:
    """Devuelve todos los resultados; carpeta_salida=None evita la persistencia.

    Se mantienen 24 h por defecto y se exige luz durante más del 50 % del
    periodo solicitado. El porcentaje se configura mediante evaluador=.
    Cada petición válida elimina los resultados anteriores antes de calcular.
    """
    for campo, valor in {"latitud": latitud, "longitud": longitud,
                         "duracion_horas": duracion_horas, "paso_horas": paso_horas}.items():
        if isinstance(valor, bool) or not isinstance(valor, (int, float)) or not math.isfinite(valor):
            raise ValueError(f"{campo} debe ser un número finito.")
    if not -90 <= latitud <= 90 or not -180 <= longitud <= 360:
        raise ValueError("Coordenadas fuera de rango.")
    inicio = pd.Timestamp(tiempo)
    if pd.isna(inicio):
        raise ValueError("El tiempo debe ser una fecha válida.")
    inicio = inicio.tz_localize("UTC") if inicio.tzinfo is None else inicio.tz_convert("UTC")
    if inicio.year < 1962 or inicio.microsecond or inicio.nanosecond:
        raise ValueError("Usa una fecha desde 1962 y segundos enteros.")
    duracion, paso = timedelta(hours=duracion_horas), timedelta(hours=paso_horas)
    if (duracion.total_seconds() < 0 or duracion.total_seconds() % 1
            or paso.total_seconds() < 60 or paso.total_seconds() % 60
            or timedelta(0) < duracion < paso or duracion // paso + 1 > 10000):
        raise ValueError("Duración/paso inválidos: segundos enteros, paso en minutos y máximo 10000 muestras.")

    with _salida_peticion(carpeta_salida) as raiz:
        # Primero se trabaja en memoria. Los generadores no publican ficheros parciales.
        datos_terreno = calcular_terreno(latitud=float(latitud), longitud=float(longitud), salida=None)
        altura_m = datos_terreno.get("elevacion_m")
        if isinstance(altura_m, bool) or not isinstance(altura_m, (int, float)) or not math.isfinite(altura_m):
            raise ValueError("El terreno no proporcionó una elevacion_m finita.")
        datos_efemerides = generar_efemerides(
            inicio_utc=inicio.to_pydatetime(), duracion=duracion, paso=paso,
            latitud_deg=float(latitud), longitud_deg=float(longitud), altura_m=float(altura_m),
            nombre=nombre, decimales=DECIMALES, salida=None,
        )
        # repr conserva signo y precisión: no colisionan hemisferios ni sitios próximos.
        clave_sitio = f"sitio_{float(latitud)!r}_{float(longitud)!r}".replace(".", "_")
        combinado = {
            "sitios": {clave_sitio: {
                "nombre": nombre, "lat": float(latitud), "lon": float(longitud),
                "elevacion_m": float(altura_m), "pendiente_deg": datos_terreno.get("pendiente_deg"),
                "horizonte_360": datos_terreno.get("horizonte_360"),
                **({"pendiente_p95_deg": datos_terreno["pendiente_p95_deg"]}
                   if "pendiente_p95_deg" in datos_terreno else {}),
                "metadatos": datos_terreno.get("metadatos", {}),
            }},
            "ephemeris": datos_efemerides["ephemeris"],
        }
        evaluacion = (evaluador or LandingSiteEvaluator()).evaluar_dataset_completo(combinado)
        documentos = {"terreno": datos_terreno, "efemerides": datos_efemerides,
                      "combinado": combinado, "evaluacion": evaluacion}
        archivos = {}
        carpeta = None
        if raiz is not None:
            carpeta = raiz / f"peticion_{uuid4().hex}"
            # Solo una carpeta completa se hace visible con el nombre definitivo.
            with TemporaryDirectory(prefix=".incompleta-", dir=raiz) as temporal:
                staging = Path(temporal).resolve()
                if staging.parent != raiz or carpeta.resolve().parent != raiz:
                    raise ValueError("La persistencia debe permanecer dentro de la carpeta de salida.")
                for clave, documento in documentos.items():
                    (staging / NOMBRES_ARCHIVOS[clave]).write_text(
                        json.dumps(documento, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
                staging.rename(carpeta)
            archivos = {clave: str(carpeta / nombre_archivo) for clave, nombre_archivo in NOMBRES_ARCHIVOS.items()}
        return {"carpeta": str(carpeta) if carpeta is not None else None,
                "archivos": archivos, **documentos}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--entrada", type=Path,
                        help="Reevaluar un JSON combinado existente, sin consultar LOLA ni Horizons")
    parser.add_argument("--tiempo", default=TIEMPO_DEFAULT, help="Instante de aterrizaje, ISO 8601")
    parser.add_argument("--lat", type=float, default=LATITUD_DEFAULT)
    parser.add_argument("--lon", type=float, default=LONGITUD_DEFAULT)
    parser.add_argument("--horas", type=float, default=DURACION_HORAS)
    parser.add_argument("--paso-horas", type=float, default=PASO_HORAS)
    parser.add_argument("--min-porcentaje-luz", type=float, default=50.0,
                        help="Porcentaje de las horas solicitadas que debe superarse con luz (0 a 100)")
    parser.add_argument("--carpeta", default=str(CARPETA_SALIDA))
    args = parser.parse_args()
    if args.entrada is not None:
        resultado = LandingSiteEvaluator(min_porcentaje_luz=args.min_porcentaje_luz).evaluar_dataset_completo(
            json.loads(args.entrada.read_text(encoding="utf-8")))
        print(json.dumps(resultado, indent=2, ensure_ascii=False, allow_nan=False))
        parser.exit()
    resultado = procesar_peticion_frontend(
        args.tiempo, args.lat, args.lon, duracion_horas=args.horas,
        paso_horas=args.paso_horas, carpeta_salida=args.carpeta,
        evaluador=LandingSiteEvaluator(min_porcentaje_luz=args.min_porcentaje_luz),
    )
    print(f"Archivos generados en {resultado['carpeta']}:")
    for clave, ruta in resultado["archivos"].items():
        print(f"  - {clave}: {ruta}")
    print(json.dumps(resultado["evaluacion"], indent=2, ensure_ascii=False, allow_nan=False))
