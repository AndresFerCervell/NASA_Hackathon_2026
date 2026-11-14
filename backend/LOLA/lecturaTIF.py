import os
import json
import numpy as np
import rasterio

# 1. Rutas a los archivos en la misma carpeta del script
carpeta = os.path.dirname(os.path.abspath(__file__))
ruta_dem = os.path.join(carpeta, "LDEM_80S_80MPP_ADJ.tiff")
ruta_slope = os.path.join(carpeta, "LDSM_80S_80MPP_ADJ.tiff")
ruta_salida_json = os.path.join(carpeta, "datos_lunares.json")

R_LUNA = 1737400.0  # Radio medio de la Luna en metros

def latlon_a_xy_estereografico(lat_deg, lon_deg):
    """Convierte Latitud/Longitud lunar (Polo Sur) a metros X, Y del archivo LOLA."""
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    # Proyección estereográfica polar sur estándar de LOLA
    r = 2 * R_LUNA * np.tan(np.pi / 4 + lat / 2)
    x = r * np.sin(lon)
    y = r * np.cos(lon)
    return x, y

def calcular_perfil_horizonte(dem, transform, lat, lon, radio_max_km=80):
    """Calcula el ángulo máximo de las montañas en cada uno de los 360 grados."""
    x0, y0 = latlon_a_xy_estereografico(lat, lon)
    fila0, col0 = rasterio.transform.rowcol(transform, x0, y0)
    h0 = float(dem[fila0, col0])
    
    resolucion_m = abs(transform.a)  # 80 metros por píxel
    pasos_distancia = np.arange(resolucion_m, radio_max_km * 1000, resolucion_m)
    horizonte_360 = []

    for az_deg in range(360):
        # Acimut: 0° = Norte (+Y), 90° = Este (+X)
        az_rad = np.radians(az_deg)
        xs = x0 + pasos_distancia * np.sin(az_rad)
        ys = y0 + pasos_distancia * np.cos(az_rad)
        
        filas, cols = rasterio.transform.rowcol(transform, xs, ys)
        filas = np.array(filas)
        cols = np.array(cols)
        
        # Filtrar puntos dentro de los límites de la imagen
        validos = (filas >= 0) & (filas < dem.shape[0]) & (cols >= 0) & (cols < dem.shape[1])
        filas, cols, dists = filas[validos], cols[validos], pasos_distancia[validos]
        
        alturas = dem[filas, cols]
        # Ángulo aparente descontando la curvatura lunar
        angulos_rad = np.arctan((alturas - h0) / dists) - (dists / (2 * R_LUNA))
        max_angulo_deg = float(np.degrees(np.max(angulos_rad)))
        
        horizonte_360.append(round(max_angulo_deg, 3))
        
    return h0, horizonte_360

# 2. Definir tus sitios candidatos del Polo Sur
sitios_candidatos = {
    "shackleton_rim": {
        "nombre": "Borde Cráter Shackleton (Polo Sur)",
        "lat": -89.65,
        "lon": 129.2
    },
    "malapert_massif": {
        "nombre": "Macizo Malapert (Pico de luz)",
        "lat": -85.95,
        "lon": -2.5
    }
}

datos_completos = {"sitios": {}}

# 3. Procesar los archivos TIF
with rasterio.open(ruta_dem) as ds_dem, rasterio.open(ruta_slope) as ds_slope:
    dem_matriz = ds_dem.read(1)
    slope_matriz = ds_slope.read(1)
    transform = ds_dem.transform

    for clave, info in sitios_candidatos.items():
        lat, lon = info["lat"], info["lon"]
        x, y = latlon_a_xy_estereografico(lat, lon)
        fila, col = rasterio.transform.rowcol(transform, x, y)
        
        pendiente = float(slope_matriz[fila, col])
        elevacion, horizonte = calcular_perfil_horizonte(dem_matriz, transform, lat, lon)
        
        datos_completos["sitios"][clave] = {
            "nombre": info["nombre"],
            "lat": lat,
            "lon": lon,
            "elevacion_m": round(elevacion, 2),
            "pendiente_deg": round(pendiente, 2),
            "horizonte_360": horizonte
        }
        print(f"Procesado {info['nombre']}: Altura={elevacion:.1f}m, Pendiente={pendiente:.1f}°")

# 4. Añadir el sitio de comparación ecuatorial (Apolo 11 - terreno plano)
datos_completos["sitios"]["apollo_11"] = {
    "nombre": "Tranquility Base (Apolo 11 - Ecuador)",
    "lat": 0.674,
    "lon": 23.473,
    "elevacion_m": -1850.0,
    "pendiente_deg": 1.8,
    "horizonte_360": [0.1] * 360  # Llanura ecuatorial sin montañas altas
}

# 5. Guardar el JSON ligero listo para subir a GitHub
with open(ruta_salida_json, "w", encoding="utf-8") as f:
    json.dump(datos_completos, f, indent=2, ensure_ascii=False)

print(f"\n¡Listo! Archivo guardado en: {ruta_salida_json}")