"""Recibe tiempo, latitud y longitud (desde el frontend o CLI), calcula el JSON de
terreno con LOLA_Terreno/terreno_lola.py y el JSON de efemérides con efemerides_lunar.py,
y guarda los resultados en la carpeta 'datos_lunares/'.

Ejecutar por CLI:
    uv run python procesar_sitio_lunar.py --tiempo "2026-11-14T12:00:00Z" --lat -89.65 --lon 129.2
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta
import json
from pathlib import Path
import sys

RAIZ_REPO = Path(__file__).resolve().parent
if str(RAIZ_REPO) not in sys.path:
    sys.path.insert(0, str(RAIZ_REPO))

from LOLA_Terreno.terreno_lola import calcular_terreno
from efemerides_lunar import DECIMALES, DURACION_HORAS, PASO_HORAS, generar_efemerides

from calculos import LandingSiteEvaluator
CARPETA_SALIDA = RAIZ_REPO / "datos_lunares"

# Valores por defecto de ejemplo
TIEMPO_DEFAULT = "2026-11-14T12:00:00Z"
LATITUD_DEFAULT = -89.65
LONGITUD_DEFAULT = 129.2


def procesar_peticion_frontend(
    tiempo: str | datetime,
    latitud: float,
    longitud: float,
    *,
    duracion_horas: float = DURACION_HORAS,
    paso_horas: float = PASO_HORAS,
    carpeta_salida: Path | str = CARPETA_SALIDA,
    nombre: str = "Sitio lunar",
) -> dict:
    """Calcula terreno LOLA y efemérides Horizons y los guarda en 'datos_lunares/'."""
    carpeta = Path(carpeta_salida)
    carpeta.mkdir(parents=True, exist_ok=True)

    ruta_terreno = carpeta / "terreno.json"
    ruta_efemerides = carpeta / "efemerides.json"
    ruta_combinado = carpeta / "datos_lunares.json"

    # 1. Calcular el JSON del terreno usando terreno_lola.py
    datos_terreno = calcular_terreno(
        latitud=float(latitud),
        longitud=float(longitud),
        salida=ruta_terreno,
    )

    # Usamos la elevación calculada por LOLA como altura del punto lunar
    altura_m = float(datos_terreno.get("elevacion_m", 0.0))

    # 2. Calcular el JSON de efemérides usando efemerides_lunar.py
    datos_efemerides = generar_efemerides(
        inicio_utc=tiempo,
        duracion=timedelta(hours=duracion_horas),
        paso=timedelta(hours=paso_horas),
        latitud_deg=float(latitud),
        longitud_deg=float(longitud),
        altura_m=altura_m,
        nombre=nombre,
        decimales=DECIMALES,
        salida=ruta_efemerides,
    )
   

# 3. Guardar también un JSON combinado con terreno + efemérides en la misma carpeta
    # (MODIFICADO para coincidir con la entrada del evaluador)
    clave_sitio = f"sitio_{abs(latitud)}_{abs(longitud)}".replace(".", "_")
    
    resultado_combinado = {
        "sitios": {
            clave_sitio: {
                "nombre": nombre,
                "lat": float(latitud),
                "lon": float(longitud),
                "elevacion_m": altura_m,
                "pendiente_deg": float(datos_terreno.get("pendiente_deg", 0.0)),
                "horizonte_360": datos_terreno.get("horizonte_360", [])
            }
        },
        "ephemeris": {
            "t0_aterrizaje": str(tiempo),
            "timeline": datos_efemerides.get("ephemeris", []) # <--- CAMBIO REALIZADO AQUÍ
        }
    }

    # Instancias la clase (puedes pasarle los parámetros que quieras)
    evaluador = LandingSiteEvaluator(min_angulo_solar_deg=5.0)
    
    # Le pasas el resultado_combinado que acabas de construir
    resultados_evaluacion = evaluador.evaluar_dataset_completo(resultado_combinado)
    
    # Opcional: Si quieres guardar la evaluación también en un archivo JSON:
    ruta_evaluacion = carpeta / "evaluacion.json"
    ruta_evaluacion.write_text(
        json.dumps(resultados_evaluacion, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    
    ruta_combinado.write_text(
        json.dumps(resultado_combinado, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    ruta_combinado.write_text(
        json.dumps(resultado_combinado, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    return {
        "carpeta": str(carpeta.resolve()),
        "archivos": {
            "terreno": str(ruta_terreno.resolve()),
            "efemerides": str(ruta_efemerides.resolve()),
            "combinado": str(ruta_combinado.resolve()),
            "evaluacion": str(ruta_evaluacion.resolve()), # Añadimos la ruta del archivo
        },
        "terreno": datos_terreno,
        "efemerides": datos_efemerides,
        "evaluacion": resultados_evaluacion, # <--- ESTO ES LO QUE FALTABA
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tiempo", default=TIEMPO_DEFAULT, help="Tiempo UTC de aterrizaje (ISO 8601)")
    parser.add_argument("--lat", type=float, default=LATITUD_DEFAULT, help="Latitud lunar en grados (-90, 90)")
    parser.add_argument("--lon", type=float, default=LONGITUD_DEFAULT, help="Longitud lunar en grados [-180, 360]")
    parser.add_argument("--horas", type=float, default=DURACION_HORAS, help="Duración de efemérides en horas")
    parser.add_argument("--paso-horas", type=float, default=PASO_HORAS, help="Paso entre muestras en horas")
    parser.add_argument("--carpeta", default=str(CARPETA_SALIDA), help="Carpeta donde guardar los JSON")
    args = parser.parse_args()

    res = procesar_peticion_frontend(
        tiempo=args.tiempo,
        latitud=args.lat,
        longitud=args.lon,
        duracion_horas=args.horas,
        paso_horas=args.paso_horas,
        carpeta_salida=args.carpeta,
    )
    print(f"Archivos generados en {res['carpeta']}:")
    for clave, ruta in res["archivos"].items():
        print(f"  - {clave}: {ruta}")
    
    # AÑADE ESTO: Imprimir el resultado de la evaluación en pantalla
    print("\n" + "="*50)
    print("RESULTADO DE LA EVALUACIÓN DEL SITIO:")
    print("="*50)
    
    # Extraemos la evaluación del diccionario de respuesta y la imprimimos en formato JSON
    evaluacion_json = json.dumps(res["evaluacion"], indent=2, ensure_ascii=False)
    print(evaluacion_json)