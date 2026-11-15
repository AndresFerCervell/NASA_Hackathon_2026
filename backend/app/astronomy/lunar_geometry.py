"""Geometric lunar-site ephemerides shared by the API and evaluation pipeline.

All positions are instantaneous ICRF vectors in km. No terrain or solar disk model.
"""
from __future__ import annotations

import csv
import io
import json
import time
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import requests

HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
RADIO_TIERRA_KM = 6371.0
COLUMNAS_POSICION = [f"{body}_{axis}_km" for body in ("tierra", "sol") for axis in "xyz"]
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
TOTAL_TIMEOUT_SECONDS = 90.0


class HorizonsError(RuntimeError):
    """The upstream service returned invalid or incomplete ephemerides."""


class HorizonsTimeout(HorizonsError):
    """The upstream query exceeded its time budget."""


def angulos_locales(
    vector_km: np.ndarray, normal: np.ndarray, polo_norte: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Distancia y ángulos geométricos en el sistema local Este-Norte-Arriba.

    Acimut horario: norte lunar=0, este=90, sur=180, oeste=270 grados.
    Normal y polo_norte son vectores unitarios en los mismos ejes ICRF.
    El acimut es NaN en los polos lunares o si el cuerpo está en cénit/nadir.
    """
    distancia = np.linalg.norm(vector_km, axis=1)
    direccion = vector_km / distancia[:, None]
    este = np.cross(polo_norte, normal)
    norma_este = np.linalg.norm(este, axis=1)
    este = np.divide(este, norma_este[:, None], out=np.full_like(este, np.nan),
                     where=norma_este[:, None] > 1e-12)
    norte = np.cross(normal, este)
    componente_up = np.clip(np.einsum("ij,ij->i", direccion, normal), -1.0, 1.0)
    componente_e = np.einsum("ij,ij->i", direccion, este)
    componente_n = np.einsum("ij,ij->i", direccion, norte)
    theta = np.degrees(np.arccos(componente_up))
    elevacion = 90.0 - theta
    acimut = np.degrees(np.arctan2(componente_e, componente_n)) % 360.0
    acimut = np.where(np.isclose(acimut, 360.0, atol=1e-10, rtol=0), 0.0, acimut)
    acimut = np.where(np.hypot(componente_e, componente_n) <= 1e-12, np.nan, acimut)
    return distancia, elevacion, acimut, theta


def tierra_bloquea_segmento_sol(
    sol_km: np.ndarray, tierra_km: np.ndarray, radio_tierra_km: float = RADIO_TIERRA_KM
) -> np.ndarray:
    """Intersección del segmento punto-centro solar con una Tierra esférica."""
    distancia_sol = np.linalg.norm(sol_km, axis=1)
    direccion = sol_km / distancia_sol[:, None]
    proyeccion = np.einsum("ij,ij->i", tierra_km, direccion)
    perpendicular = tierra_km - proyeccion[:, None] * direccion
    discriminante = radio_tierra_km**2 - np.einsum("ij,ij->i", perpendicular, perpendicular)
    semilongitud = np.sqrt(np.maximum(discriminante, 0.0))
    return ((discriminante >= 0) & (proyeccion + semilongitud > 0)
            & (proyeccion - semilongitud < distancia_sol))


def posiciones_desde_luna(
    inicio_utc: str | datetime,
    duracion: timedelta,
    paso: timedelta,
    sitio_lunar: tuple[float, float, float] | None = None,
) -> pd.DataFrame:
    """Devuelve una tabla con tiempo UTC, segundos desde el inicio y posiciones ICRF en km.

    sitio_lunar: (longitud_este_deg, latitud_norte_deg, altitud_km), o None para el centro.
    duracion=0 consulta solo el instante inicial.
    Fechas desde 1962 (UT equivale a UTC en Horizons). Límite local de 10000 muestras.
    Las fechas sin zona se interpretan como UTC; las que tienen zona se convierten a UTC.
    """
    inicio = pd.Timestamp(inicio_utc)
    if pd.isna(inicio):
        raise ValueError("El inicio debe ser una fecha válida.")
    inicio = inicio.tz_localize("UTC") if inicio.tzinfo is None else inicio.tz_convert("UTC")
    if inicio.year < 1962:
        raise ValueError("Usa fechas desde 1962 para que UT corresponda a UTC.")
    if inicio.microsecond or inicio.nanosecond:
        raise ValueError("Especifica el inicio con precisión de segundos enteros.")
    duracion = pd.Timedelta(duracion)
    paso = pd.Timedelta(paso)
    if pd.isna(duracion) or duracion < pd.Timedelta(0):
        raise ValueError("La duración debe ser no negativa; cero consulta un instante.")
    if duracion % pd.Timedelta(seconds=1):
        raise ValueError("La duración debe ser un número entero de segundos.")
    if pd.isna(paso) or paso < pd.Timedelta(minutes=1) or paso % pd.Timedelta(minutes=1):
        raise ValueError("El paso debe ser un número entero de minutos, como mínimo 1.")
    if pd.Timedelta(0) < duracion < paso:
        raise ValueError("La duración debe ser al menos igual al paso.")
    n = int(duracion // paso) + 1
    if n > 10000:
        raise ValueError(f"Se solicitan {n} muestras; aumenta el paso o reduce la duración (máximo local: 10000).")
    fin = inicio + duracion
    esperados = pd.date_range(inicio, periods=n, freq=paso)

    parametros = {
        "format": "json",
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "VECTORS",
        "CENTER": "500@301",
        "START_TIME": inicio.strftime("%Y-%m-%d %H:%M:%S"),
        "STOP_TIME": fin.strftime("%Y-%m-%d %H:%M:%S"),
        "STEP_SIZE": f"{int(paso // pd.Timedelta(minutes=1))} m",
        "TIME_TYPE": "UT",
        "TIME_DIGITS": "FRACSEC",
        "CAL_TYPE": "GREGORIAN",
        "REF_SYSTEM": "ICRF",
        "REF_PLANE": "FRAME",
        "VEC_CORR": "NONE",
        "OUT_UNITS": "KM-S",
        "VEC_TABLE": "1",
        "CSV_FORMAT": "YES",
    }

    if duracion == pd.Timedelta(0):
        # TLIST permite pedir un único instante sin inventar un margen temporal.
        for clave in ("START_TIME", "STOP_TIME", "STEP_SIZE"):
            parametros.pop(clave)
        parametros.update(TLIST=inicio.strftime("%Y-%m-%d %H:%M:%S"), TLIST_TYPE="CAL")
    if sitio_lunar is not None:
        sitio = np.asarray(sitio_lunar, dtype=float)
        if sitio.shape != (3,) or not np.isfinite(sitio).all():
            raise ValueError("sitio_lunar debe contener longitud, latitud y altitud finitas.")
        lon, lat, alt = sitio
        if not (-180 <= lon <= 360 and -90 <= lat <= 90):
            raise ValueError("Longitud fuera de [-180, 360] o latitud fuera de [-90, 90].")
        parametros.update(CENTER="coord@301", COORD_TYPE="GEODETIC",
                          SITE_COORD=f"{lon:.10f},{lat:.10f},{alt:.10f}")
    cabeceras = {}
    deadline = time.monotonic() + TOTAL_TIMEOUT_SECONDS

    def consultar(sesion, cuerpo, identificador):
        # Requests codifica los parámetros; Horizons requiere comillas en sus valores.
        consulta = {k: (v if k == "format" else f"'{v}'") for k, v in parametros.items()}
        consulta["COMMAND"] = f"'{identificador}'"
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise HorizonsTimeout("Horizons query deadline exceeded")
        try:
            with sesion.get(HORIZONS_URL, params=consulta, stream=True,
                            timeout=(min(10.0, remaining), min(30.0, remaining))) as respuesta:
                respuesta.raise_for_status()
                body = bytearray()
                for chunk in respuesta.iter_content(chunk_size=65536):
                    if time.monotonic() > deadline:
                        raise HorizonsTimeout("Horizons query deadline exceeded")
                    body.extend(chunk)
                    if len(body) > MAX_RESPONSE_BYTES:
                        raise HorizonsError("Horizons response is too large")
                contenido = json.loads(body)
            if not isinstance(contenido, dict):
                raise HorizonsError("Horizons JSON must be an object")
        except requests.Timeout as error:
            raise HorizonsTimeout(f"Horizons timed out for {cuerpo}") from error
        except (requests.RequestException, ValueError) as error:
            raise HorizonsError(f"Invalid Horizons response for {cuerpo}") from error
        if contenido.get("error"):
            raise HorizonsError(f"Horizons ({cuerpo}): {contenido['error']}")
        texto = contenido.get("result", "")
        if not isinstance(texto, str) or "$$SOE" not in texto or "$$EOE" not in texto:
            raise HorizonsError(f"Horizons no devolvió vectores para {cuerpo}: {str(texto)[:2000]}")
        cabeceras[cuerpo] = texto.split("$$SOE", 1)[0]
        bloque = texto.split("$$SOE", 1)[1].split("$$EOE", 1)[0].strip()
        filas = [fila for fila in csv.reader(io.StringIO(bloque)) if fila and fila[0].strip()]
        if len(filas) != n or any(len(fila) < 5 for fila in filas):
            raise HorizonsError(f"Tabla incompleta o inesperada para {cuerpo}: {len(filas)} filas, esperadas {n}.")
        months = {m: i for i, m in enumerate(
            ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"), 1)}
        try:
            dates = []
            for fila in filas:
                date, clock = fila[1].strip().removeprefix("A.D. ").split()
                year, month, day = date.split("-")
                dates.append(pd.Timestamp(f"{year}-{months[month]:02d}-{day}T{clock}Z"))
            fechas = pd.DatetimeIndex(dates)
            xyz = np.array([[float(valor) for valor in fila[2:5]] for fila in filas])
        except (ValueError, KeyError, OverflowError) as error:
            raise HorizonsError(f"Invalid vector table for {cuerpo}") from error
        if not fechas.equals(esperados):
            raise HorizonsError(f"Las fechas devueltas para {cuerpo} no coinciden con el muestreo solicitado.")
        if not np.isfinite(xyz).all() or np.any(np.linalg.norm(xyz, axis=1) == 0):
            raise HorizonsError(f"Horizons devolvió posiciones no finitas o nulas para {cuerpo}.")
        return xyz

    # Peticiones secuenciales, siguiendo la política de uso de las APIs de SSD.
    with requests.Session() as sesion:
        tierra = consultar(sesion, "Tierra", 399)
        sol = consultar(sesion, "Sol", 10)
        if sitio_lunar is not None:
            # El vector al centro lunar da la normal en ICRF para cada instante.
            luna = consultar(sesion, "Luna", 301)
            # Desde el polo norte lunar hacia el centro obtenemos el eje norte exacto
            # del mismo modelo de rotación de Horizons, en cada instante.
            coordenadas_originales = parametros["SITE_COORD"]
            parametros["SITE_COORD"] = "0,90,0"
            try:
                luna_desde_polo = consultar(sesion, "Eje norte lunar", 301)
            finally:
                parametros["SITE_COORD"] = coordenadas_originales
            polo_norte = -luna_desde_polo / np.linalg.norm(luna_desde_polo, axis=1)[:, None]

    tabla = pd.DataFrame(np.column_stack((tierra, sol)), columns=COLUMNAS_POSICION)
    tabla.insert(0, "t_segundos", (esperados - inicio).total_seconds())
    tabla.insert(0, "tiempo_utc", esperados)
    tabla.attrs.update(origen="Centro de la Luna (301)", marco="ICRF / FRAME",
                       unidades="km", escala_temporal="UTC", correccion="NONE")
    if sitio_lunar is not None:
        tabla.attrs.update(origen="Punto de la superficie lunar", sitio_lunar=tuple(sitio))
        normal = -luna / np.linalg.norm(luna, axis=1)[:, None]
        for cuerpo, vector in (("sol", sol), ("tierra", tierra)):
            distancia, elevacion, acimut, theta = angulos_locales(vector, normal, polo_norte)
            tabla[f"distancia_{cuerpo}_km"] = distancia
            tabla[f"elevacion_{cuerpo}_deg"] = elevacion
            tabla[f"acimut_{cuerpo}_deg"] = acimut
            tabla[f"angulo_normal_{cuerpo}_deg"] = theta
        # Visibilidad del centro terrestre sobre el horizonte local, sin relieve.
        tabla["tierra_visible"] = tabla["elevacion_tierra_deg"] > 0.0
        tabla["conexion_tierra"] = tabla["tierra_visible"]
        tabla.attrs["modelo_conexion"] = (
            "Conexion definida como centro terrestre sobre horizonte local; "
            "sin terreno ni estacion terrestre especifica, altitud de referencia cero."
        )
        tabla["sol_sobre_horizonte"] = np.einsum("ij,ij->i", sol, normal) > 0
        tabla["tierra_bloquea_sol"] = tierra_bloquea_segmento_sol(sol, tierra)
        tabla["iluminado_sin_terreno"] = tabla["sol_sobre_horizonte"] & ~tabla["tierra_bloquea_sol"]
        tabla["iluminado"] = tabla["iluminado_sin_terreno"]  # Alias para compatibilidad.
        tabla.attrs["angulos"] = (
            "Geométricos; elevación sobre el horizontal local; acimut desde norte lunar "
            "hacia este; theta respecto a normal radial; grados."
        )
        tabla.attrs["modelo_iluminacion"] = (
            f"Sol puntual, horizonte de Luna esférica, Tierra esférica de radio {RADIO_TIERRA_KM:g} km; "
            "sin relieve, atmósfera ni eclipses parciales del disco solar."
        )
    else:
        for cuerpo, vector in (("tierra", tierra), ("sol", sol)):
            tabla[f"distancia_{cuerpo}_km"] = np.linalg.norm(vector, axis=1)
    tabla.attrs["cabeceras_horizons"] = cabeceras
    return tabla


def calcular_desde_lugar(
    inicio_utc: str | datetime, duracion: timedelta, paso: timedelta, *,
    latitud_deg: float, longitud_deg: float, altura_m: float = 0.0,
    nombre: str = "Lugar lunar",
) -> pd.DataFrame:
    """Consulta un punto lunar configurable mediante parámetros con nombre.

    latitud_deg: norte positivo, sur negativo; rango [-90,90].
    longitud_deg: este positivo, oeste negativo; rango [-180,360].
    altura_m: metros sobre la superficie de referencia lunar de Horizons.
    No es la altura sobre el terreno local ni una distancia desde el centro lunar.
    """
    coordenadas = np.asarray([latitud_deg, longitud_deg, altura_m], dtype=float)
    if not np.isfinite(coordenadas).all():
        raise ValueError("Latitud, longitud y altura deben ser números finitos.")
    latitud, longitud, altura = coordenadas
    tabla = posiciones_desde_luna(
        inicio_utc, duracion, paso,
        sitio_lunar=(longitud, latitud, altura / 1000.0),
    )
    tabla.attrs["lugar"] = dict(nombre=nombre, latitud_deg=float(latitud),
                               longitud_deg=float(longitud), altura_m=float(altura))
    return tabla


# Adaptador al contrato de evaluación: misma geometría, sin otra consulta.
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
        timeline.append(
            {
                # El redondeo de presentación no debe modificar los intervalos.
                "hora_offset": horas,
                "sol_elevacion_deg": _redondear_angulo(fila["elevacion_sol_deg"], decimales),
                "sol_azimut_deg": _redondear_angulo(fila["acimut_sol_deg"], decimales),
                "tierra_elevacion_deg": _redondear_angulo(fila["elevacion_tierra_deg"], decimales),
                "tierra_azimut_deg": _redondear_angulo(fila["acimut_tierra_deg"], decimales),
                "tierra_bloquea_sol": bool(fila["tierra_bloquea_sol"]),
            }
        )

    resultado = {
        "ephemeris": {
            "t0_aterrizaje": t0_iso,
            "lugar": {
                "latitud_deg": float(latitud_deg),
                "longitud_deg": float(longitud_deg),
                "altura_m": float(altura_m),
            },
            "fuente": "JPL Horizons",
            "unidades": {"angulos": "deg", "tiempo": "h", "altura": "m"},
            "modelo": {
                "eclipse": "segmento_sol_puntual_tierra_esferica",
                "radio_tierra_km": RADIO_TIERRA_KM,
                "posiciones": "geometricas instantaneas ICRF, VEC_CORR=NONE",
                "datum_altura": "superficie de referencia lunar de Horizons",
            },
            "duracion_solicitada_horas": duracion.total_seconds() / 3600.0,
            "paso_horas": paso.total_seconds() / 3600.0,
            "decimales_angulos": decimales,
            "timeline": timeline,
        }
    }

    if salida is not None:
        ruta = Path(salida)
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_text(
            json.dumps(resultado, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
            encoding="utf-8",
        )

    return resultado
