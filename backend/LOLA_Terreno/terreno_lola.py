"""LOLA -> elevación, pendiente máxima local y horizonte de 360 direcciones.

Instalar: pip install numpy requests rasterio pyproj
Ejecutar: python terreno_lola.py
Salida automática: terreno_latitud_longitud_altura.json (altura en metros).
Script autónomo: contiene todos los cálculos y no requiere notebooks ni otros scripts.
Exporta latitud, longitud, elevacion_m, pendiente_deg, horizonte_360 y metadatos.
La primera ejecución descarga el DEM global; las siguientes reutilizan la copia local.
La pendiente usa recortes remotos de alta resolución o DEM_LOCAL.
"""
from pathlib import Path
import argparse
import json
import re

import numpy as np
import requests
import rasterio
from rasterio.windows import Window
from pyproj import Transformer, Geod

# ==============================================================================
# PARÁMETROS DE CONFIGURACIÓN (modifica estos valores antes de ejecutar)
# ==============================================================================
LATITUD = -89.65
LONGITUD = 129.2
PPD = 16
RADIO_KM = 200
PASO_M = None
RADIO_PENDIENTE_M = 200
DEM_LOCAL = None  # Selección automática según coordenadas
# ==============================================================================

RADIO_LUNA = 1_737_400.0  # metros
BASE = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/"
DEM_SUR = "https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_83S_10MPP_ADJ.TIF"
CARPETA_SCRIPT = Path(__file__).resolve().parent
CARPETA_DATOS = CARPETA_SCRIPT / "datos"
SALIDA_PREDETERMINADA = CARPETA_SCRIPT / "terreno_{latitud}_{longitud}_{elevacion_m:.2f}.json"


def cargar_lola(ppd=64):
    """Descarga LDEM global y lo abre sin cargar todo el mapa en RAM."""
    if ppd not in (4, 16, 64):
        raise ValueError("ppd debe ser 4, 16 o 64.")
    CARPETA_DATOS.mkdir(parents=True, exist_ok=True)
    nombre = f"ldem_{ppd}"
    etiqueta = CARPETA_DATOS / f"{nombre}.lbl"
    imagen = CARPETA_DATOS / f"{nombre}.img"
    if not etiqueta.exists():
        r = requests.get(BASE + etiqueta.name, timeout=60)
        r.raise_for_status()
        etiqueta.write_text(r.text, encoding="ascii")
    texto = etiqueta.read_text(encoding="ascii")

    def campo(nombre):
        return re.search(rf"^\s*{nombre}\s*=\s*([^\r\n]+)", texto, re.M).group(1).strip().strip('"')

    filas, columnas = int(campo("LINES")), int(campo("LINE_SAMPLES"))
    escala = float(campo("SCALING_FACTOR"))
    if (filas, columnas) != (180 * ppd, 360 * ppd) or campo("SAMPLE_TYPE") != "LSB_INTEGER" or int(campo("SAMPLE_BITS")) != 16:
        raise ValueError("Formato LOLA inesperado; revisa la etiqueta PDS.")
    if float(campo("OFFSET")) != RADIO_LUNA:
        raise ValueError("Radio de referencia inesperado.")
    tamano = filas * columnas * 2
    if not imagen.exists() or imagen.stat().st_size != tamano:
        print(f"Descargando {nombre}: {tamano / 1e6:.1f} MB (solo la primera vez)...", flush=True)
        temporal = imagen.with_suffix(".part")
        try:
            with requests.get(BASE + imagen.name, stream=True, timeout=(20, 90)) as r:
                r.raise_for_status()
                with temporal.open("wb") as f:
                    for bloque in r.iter_content(1024 * 1024):
                        f.write(bloque)
            if temporal.stat().st_size != tamano:
                raise ValueError("Descarga incompleta; vuelve a ejecutar.")
            temporal.replace(imagen)
        finally:
            temporal.unlink(missing_ok=True)
    datos = np.memmap(imagen, dtype="<i2", mode="r", shape=(filas, columnas))
    return datos, escala


def elevacion(datos, escala, lat, lon):
    """Interpola entre centros de píxel; longitud periódica y extremos polares limitados."""
    ppd = datos.shape[0] / 180
    y = np.clip((90 - np.asarray(lat)) * ppd - 0.5, 0, datos.shape[0] - 1)
    x = (np.asarray(lon) % 360) * ppd - 0.5
    i, j = np.floor(y).astype(int), np.floor(x).astype(int)
    fy, fx = y - i, x - j
    i1, j1 = np.minimum(i + 1, datos.shape[0] - 1), (j + 1) % datos.shape[1]
    j %= datos.shape[1]
    vecinos = np.array([datos[i, j], datos[i, j1], datos[i1, j], datos[i1, j1]], dtype=float)
    if np.any(~np.isfinite(vecinos) | (vecinos <= -32768) | (vecinos >= 32767)):
        raise ValueError("Hay datos ausentes en el DEM.")
    a, b, c, d = vecinos * escala
    # La etiqueta especifica altura = DN * escala. OFFSET solo se suma para obtener RADIO.
    return (1 - fy) * ((1 - fx) * a + fx * b) + fy * ((1 - fx) * c + fx * d)


def pendiente_pixel(datos, escala, lat, lon):
    """Magnitud máxima de pendiente: atan(|gradiente|), estimada con Horn 3x3."""
    ppd = datos.shape[0] / 180
    fila = min(int((90 - lat) * ppd), datos.shape[0] - 1)
    col = int((lon % 360) * ppd) % datos.shape[1]
    latc, lonc = 90 - (fila + 0.5) / ppd, (col + 0.5) / ppd
    lats = np.clip(latc + np.array([1, 0, -1]) / ppd, -90 + 0.5 / ppd, 90 - 0.5 / ppd)
    lons = lonc + np.array([-1, 0, 1]) / ppd
    z = elevacion(datos, escala, lats[:, None], lons[None, :])
    r = RADIO_LUNA + z[1, 1]
    dx = r * np.cos(np.deg2rad(latc)) * np.deg2rad(1 / ppd)
    dy_total = r * np.deg2rad(lats[0] - lats[2])
    gx = ((z[0, 2] + 2*z[1, 2] + z[2, 2]) - (z[0, 0] + 2*z[1, 0] + z[2, 0])) / (8*dx)
    gy = ((z[0, 0] + 2*z[0, 1] + z[0, 2]) - (z[2, 0] + 2*z[2, 1] + z[2, 2])) / (4*dy_total)
    return float(np.rad2deg(np.arctan(np.hypot(gx, gy))))


def horizonte(datos, escala, lat, lon, h0, radio_km=200, paso_m=None):
    """Máximo ángulo aparente muestreado sobre cada rayo, con curvatura lunar."""
    ppd = datos.shape[0] / 180
    paso_m = RADIO_LUNA * np.deg2rad(1 / ppd) / 4 if paso_m is None else paso_m
    if not (np.isfinite(radio_km) and 0 < radio_km < np.pi * RADIO_LUNA / 2000):
        raise ValueError("Radio de búsqueda fuera de rango.")
    if not (np.isfinite(paso_m) and 0 < paso_m <= radio_km * 1000):
        raise ValueError("El paso debe ser positivo y menor o igual que el radio de búsqueda.")
    if radio_km * 1000 / paso_m > 100_000:
        raise ValueError("Demasiados puntos por rayo: aumenta paso_m.")
    distancias = np.unique(np.r_[np.geomspace(min(0.1, paso_m), paso_m, 20),
                                np.arange(paso_m, radio_km * 1000, paso_m), radio_km * 1000])
    delta = distancias / RADIO_LUNA
    phi, lam = np.deg2rad([lat, lon])
    arriba = np.array([np.cos(phi)*np.cos(lam), np.cos(phi)*np.sin(lam), np.sin(phi)])
    este = np.array([-np.sin(lam), np.cos(lam), 0])
    norte = np.cross(arriba, este)
    perfil = np.empty(360)
    for i in range(360):
        az = np.deg2rad(i)
        direccion = np.sin(az)*este + np.cos(az)*norte
        puntos = np.cos(delta)[:, None]*arriba + np.sin(delta)[:, None]*direccion
        lats = np.rad2deg(np.arctan2(puntos[:, 2], np.hypot(puntos[:, 0], puntos[:, 1])))
        lons = np.rad2deg(np.arctan2(puntos[:, 1], puntos[:, 0]))
        h = elevacion(datos, escala, lats, lons)
        vertical = h - h0 - 2*(RADIO_LUNA + h)*np.sin(delta / 2)**2
        horizontal = (RADIO_LUNA + h)*np.sin(delta)
        perfil[i] = np.max(np.rad2deg(np.arctan2(vertical, horizontal)))
    return perfil


def _pendiente_30m(lat, lon, radio_m):
    """Recorte por HTTP Range de un tile LOLA 1024 PPD, sin descargarlo entero."""
    lon = lon % 360
    sur = int(np.floor(lat / 15) * 15)
    oeste = int(lon // 30 * 30)
    hemi = "n" if sur >= 0 else "s"
    nombre = f"ldem_1024_{abs(sur):02d}{hemi}_{abs(sur+15):02d}{hemi}_{oeste:03d}_{oeste+30:03d}"
    url = BASE + nombre
    respuesta = requests.get(url+'.lbl', timeout=60)
    respuesta.raise_for_status()
    def campo(k):
        return float(re.search(rf'^\s*{k}\s*=\s*([-+\d.]+)',respuesta.text,re.M).group(1))
    filas, cols = int(campo('LINES')), int(campo('LINE_SAMPLES'))
    ppd = campo('MAP_RESOLUTION')
    if campo('SAMPLE_BITS') != 16 or campo('OFFSET') != RADIO_LUNA or ppd != 1024:
        raise ValueError('Formato inesperado en el tile LOLA.')
    fila, col = int((sur+15-lat)*ppd), int((lon-oeste)*ppd)
    dy = RADIO_LUNA*np.deg2rad(1/ppd)
    n = int(np.ceil(radio_m/(dy*np.cos(np.deg2rad(lat)))))+3
    a,b = fila-n,fila+n+1
    c,d = col-n,col+n+1
    if a<0 or b>filas or c<0 or d>cols:
        raise ValueError('El círculo cruza un borde de tile; indica un GeoTIFF local que cubra ambos lados.')
    inicio, fin = a*cols*2, b*cols*2-1
    with requests.get(url+'.img', headers={'Range':f'bytes={inicio}-{fin}'}, timeout=90, stream=True) as r:
        if r.status_code != 206 or not r.headers.get('Content-Range','').startswith(f'bytes {inicio}-{fin}/'):
            raise ValueError('El servidor no ha respetado la lectura parcial del tile.')
        contenido = r.content
    if len(contenido) != fin-inicio+1:
        raise ValueError('Recorte incompleto.')
    z = np.frombuffer(contenido,dtype='<i2').reshape(b-a,cols)[:,c:d].astype(float)*campo('SCALING_FACTOR')
    rr,cc = np.indices((z.shape[0]-2,z.shape[1]-2))
    lats = sur+15-(a+rr+1.5)/ppd
    lons = oeste+(c+cc+1.5)/ppd
    radio = RADIO_LUNA+z[1:-1,1:-1]
    dx = radio*np.deg2rad(1/ppd)*np.cos(np.deg2rad(lats))
    gy = (z[:-2,:-2]+2*z[:-2,1:-1]+z[:-2,2:]-z[2:,:-2]-2*z[2:,1:-1]-z[2:,2:])/(8*radio*np.deg2rad(1/ppd))
    gx = (z[:-2,2:]+2*z[1:-1,2:]+z[2:,2:]-z[:-2,:-2]-2*z[1:-1,:-2]-z[2:,:-2])/(8*dx)
    _,_,dist = Geod(a=RADIO_LUNA,b=RADIO_LUNA).inv(np.full_like(lats,lon),np.full_like(lats,lat),lons,lats)
    pendientes = np.rad2deg(np.arctan(np.hypot(gx,gy)))
    dentro = dist <= radio_m
    if not dentro.any() or not np.all(np.isfinite(pendientes[dentro])) or np.any(abs(z)>=16383.5):
        raise ValueError('Recorte sin cobertura válida completa.')
    i,j = np.unravel_index(np.argmax(np.where(dentro,pendientes,-np.inf)),pendientes.shape)
    return float(pendientes[i,j]), {'fuente':url+'.lbl','radio_m':radio_m,
        'pixel_norte_sur_m':dy,'pixel_este_oeste_m':dy*np.cos(np.deg2rad(lat)),
        'pixeles_evaluados':int(dentro.sum()),'latitud_maximo':float(lats[i,j]),
        'longitud_maximo':float(lons[i,j]),'metodo':'maximo Horn 3x3 en circulo geodesico',
        'nota':'Rejilla interpolada LOLA: 30 m de espaciado no garantiza 30 m de resolución efectiva.'}


def pendiente_maxima_local(lat, lon, radio_m=200, dem=None):
    """Horn 3x3 por píxel; máximo entre centros dentro del círculo geodésico.

    Selección automática: 30 m entre 60°S y 60°N; 10 m entre 83°S y 90°S.
    Fuera de allí se necesita otro GeoTIFF lunar de alta resolución mediante dem.
    Solo se leen los bloques necesarios del GeoTIFF remoto, no sus 4.8 GB.
    """
    if not (np.isfinite(radio_m) and radio_m > 0):
        raise ValueError("radio_m debe ser positivo.")
    if dem is None and -60 < lat < 60:
        return _pendiente_30m(lat, lon, radio_m)
    if dem is None and not -90 < lat <= -83:
        raise ValueError("Sin DEM automático para esta latitud. Indica dem_local de alta resolución.")
    fuente = dem or DEM_SUR
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".TIF,.tif",
                      GDAL_HTTP_TIMEOUT="60", GDAL_HTTP_MAX_RETRY="2",
                      GDAL_HTTP_MULTIRANGE="SERIAL", GDAL_INGESTED_BYTES_AT_OPEN="1048576"):
        with rasterio.open(fuente) as ds:
            if ds.crs is None or not ds.crs.is_projected or ds.crs.linear_units != "metre":
                raise ValueError("Se necesita un GeoTIFF lunar proyectado en metros.")
            if ds.transform.b or ds.transform.d:
                raise ValueError("Se necesita una rejilla sin rotación.")
            geo = ds.crs.to_wkt()
            from pyproj import CRS
            crs = CRS.from_wkt(geo)
            if abs(crs.ellipsoid.semi_major_metre - RADIO_LUNA) > 1:
                raise ValueError("El CRS no corresponde a la esfera lunar de 1737400 m.")
            forward = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)
            inverse = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True)
            x, y = forward.transform(lon, lat)
            row, col = ds.index(x, y)
            dx, dy = abs(ds.transform.a), abs(ds.transform.e)
            # Distorsión estereográfica; margen y un halo para las derivadas.
            from pyproj import Proj
            k0 = Proj(crs).get_factors(lon, lat).meridional_scale
            n = int(np.ceil(radio_m * k0 / min(dx, dy))) + 3
            win = Window(col-n, row-n, 2*n+1, 2*n+1)
            if win.col_off < 0 or win.row_off < 0 or win.col_off+win.width > ds.width or win.row_off+win.height > ds.height:
                raise ValueError("El círculo y sus vecinos salen de la cobertura del DEM.")
            z = ds.read(1, window=win, masked=True).astype(float)
            z = z.filled(np.nan) * ds.scales[0] + ds.offsets[0]
            transform = ds.window_transform(win)
    gx = (z[:-2,2:] + 2*z[1:-1,2:] + z[2:,2:] - z[:-2,:-2] - 2*z[1:-1,:-2] - z[2:,:-2]) / (8*dx)
    gy = (z[:-2,:-2] + 2*z[:-2,1:-1] + z[:-2,2:] - z[2:,:-2] - 2*z[2:,1:-1] - z[2:,2:]) / (8*dy)
    rr, cc = np.indices(gx.shape)
    xs, ys = rasterio.transform.xy(transform, rr+1, cc+1)
    xs, ys = np.asarray(xs).reshape(gx.shape), np.asarray(ys).reshape(gx.shape)
    lons, lats = inverse.transform(xs, ys)
    _, _, distancia = Geod(a=RADIO_LUNA, b=RADIO_LUNA).inv(np.full_like(lons, lon), np.full_like(lats, lat), lons, lats)
    dentro = distancia <= radio_m
    # Corrección de escala cartográfica y altura sobre la esfera de referencia.
    factores = Proj(crs).get_factors(lons, lats)
    if not np.allclose(factores.meridional_scale, factores.parallel_scale, rtol=1e-4):
        raise ValueError("Usa una proyección conforme (por ejemplo estereográfica polar).")
    k = np.asarray(factores.meridional_scale) * RADIO_LUNA / (RADIO_LUNA + z[1:-1,1:-1])
    pendientes = np.rad2deg(np.arctan(np.hypot(gx, gy) * k))
    if not dentro.any() or not np.all(np.isfinite(pendientes[dentro])):
        raise ValueError("No hay cobertura válida completa para calcular la pendiente en el círculo.")
    seleccion = np.where(dentro, pendientes, -np.inf)
    i, j = np.unravel_index(np.argmax(seleccion), seleccion.shape)
    return float(pendientes[i,j]), {
        "fuente": str(fuente), "radio_m": radio_m, "pixel_proyectado_m": [dx,dy],
        "pixeles_evaluados": int(dentro.sum()), "metodo": "maximo de pendientes Horn 3x3 en circulo geodesico",
        "latitud_maximo": float(lats[i,j]), "longitud_maximo": float(lons[i,j]),
        "nota": "Espaciado de rejilla no equivale a resolucion efectiva de las medidas LOLA; hay interpolacion.",
    }


def calcular_terreno(latitud=LATITUD, longitud=LONGITUD, ppd=PPD, radio_km=RADIO_KM, paso_m=PASO_M,
                     salida=SALIDA_PREDETERMINADA, radio_pendiente_m=RADIO_PENDIENTE_M, dem_local=DEM_LOCAL):
    """Exporta con coordenadas y altura (elevación) en el nombre; salida=None evita escribir.

    Por defecto genera: terreno_{latitud}_{longitud}_{elevacion_m:.2f}.json
    Los valores dentro del JSON conservan su precisión original.
    salida también admite una ruta explícita o una plantilla con campos del resultado.
    """
    if not (np.isfinite(latitud) and -90 < latitud < 90 and np.isfinite(longitud)):
        raise ValueError("Latitud entre -90 y 90, sin incluir los polos exactos; longitud finita.")
    if ppd not in (4, 16, 64):
        raise ValueError("ppd debe ser 4, 16 o 64.")
    resolucion = RADIO_LUNA * np.deg2rad(1 / ppd)
    paso = resolucion / 4 if paso_m is None else paso_m
    if not (np.isfinite(radio_km) and 0 < radio_km < np.pi * RADIO_LUNA / 2000
            and np.isfinite(paso) and 0 < paso <= radio_km * 1000
            and radio_km * 1000 / paso <= 100_000):
        raise ValueError("Radio o paso de búsqueda no válidos.")
    longitud = (longitud + 180) % 360 - 180
    pendiente, info_pendiente = pendiente_maxima_local(latitud, longitud, radio_pendiente_m, dem_local)
    datos, escala = cargar_lola(ppd)
    h = float(elevacion(datos, escala, latitud, longitud))
    resultado = {
        "latitud": float(latitud), "longitud": float(longitud), "elevacion_m": h,
        "pendiente_deg": pendiente,
        "horizonte_360": horizonte(datos, escala, latitud, longitud, h, radio_km, paso).tolist(),
        "metadatos": {
            "fuente": BASE + f"ldem_{ppd}.lbl", "producto": f"LDEM_{ppd}",
            "radio_referencia_m": RADIO_LUNA, "resolucion_norte_sur_m": resolucion,
            "radio_busqueda_km": radio_km, "paso_m": paso,
            "coordenadas": "Latitud planetocentrica, longitud este; ME/PA DE421",
            "acimut": "indice i = i grados: 0 norte, 90 este, 180 sur, 270 oeste",
            "pendiente": info_pendiente,
            "horizonte": "Grados sobre la horizontal local. Observador a altura 0 sobre el DEM. Puede ser negativo.",
            "limites": "Maximo muestreado, no continuo; solo dentro del radio. Sin detalle subpixel. "
                       "Menor fiabilidad cerca de polos; semiceldas polares limitadas al anillo mas cercano.",
        },
    }
    if salida is not None:
        destino = Path(str(salida).format(altura=h, **resultado))
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_text(json.dumps(resultado, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    return resultado


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lat", type=float, default=LATITUD)
    parser.add_argument("--lon", type=float, default=LONGITUD)
    parser.add_argument("--ppd", type=int, choices=[4, 16, 64], default=PPD)
    parser.add_argument("--radio-km", type=float, default=RADIO_KM)
    parser.add_argument("--paso-m", type=float, default=PASO_M)
    parser.add_argument("--salida", default=SALIDA_PREDETERMINADA,
                        help="Ruta opcional; por defecto terreno_latitud_longitud_altura.json")
    parser.add_argument("--radio-pendiente-m", type=float, default=RADIO_PENDIENTE_M)
    parser.add_argument("--dem-local", default=DEM_LOCAL,
                        help="GeoTIFF lunar; automático: LOLA 30 m en latitudes bajas, 10 m en el sur polar")
    args = parser.parse_args()
    resultado = calcular_terreno(args.lat, args.lon, args.ppd, args.radio_km, args.paso_m, args.salida,
                                 args.radio_pendiente_m, args.dem_local)
    destino_final = Path(str(args.salida).format(altura=resultado["elevacion_m"], **resultado)).resolve()
    print(f"Guardado: {destino_final}")
    print(f"Elevación: {resultado['elevacion_m']:.2f} m; pendiente: {resultado['pendiente_deg']:.2f}°")
