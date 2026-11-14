# NASA Space Apps Challenge
## Hackathon 2026

**Project:** Lunar Landing Site Navigator

## Lunar-site geometry API

The backend accepts frontend coordinates and time intervals at `POST /api/lunar-geometry`.
See [the request contract, frontend example and deployment instructions](backend/LUNAR_GEOMETRY.md).

## Lunar topography experiments

### Topografía lunar en un único script

Desde la raíz, con las dependencias de `pyproject.toml` instaladas:

```bash
python LOLA_Terreno/terreno_lola.py --lat 0.67416 --lon 23.47314 --ppd 16
```

`LOLA_Terreno/terreno_lola.py` contiene todos los cálculos topográficos y puede
ejecutarse directamente, sin notebook ni módulos auxiliares del proyecto.
Exporta `latitud`, `longitud`, `elevacion_m`, `pendiente_deg`, `horizonte_360`
y `metadatos` en un único JSON. La pendiente es la máxima en un radio de 200 m
por defecto; el horizonte contiene 360 ángulos, uno por acimut entero
(0 norte, 90 este, 180 sur, 270 oeste), con curvatura lunar.

El nombre se genera automáticamente: `terreno_LATITUD_LONGITUD_ELEVACION.json`,
con seis decimales para las coordenadas y dos para la elevación en metros.
Se guarda en la carpeta desde la que se ejecuta el comando. Por ejemplo:
`terreno_0.674160_23.473140_-1921.62.json`. El contenido conserva su precisión original.

```bash
python LOLA_Terreno/terreno_lola.py --lat -89.65 --lon 129.2 --ppd 16 --radio-km 200 --radio-pendiente-m 200
```

Consulta `python LOLA_Terreno/terreno_lola.py --help` para ajustar resolución,
radios, paso espacial y DEM local. Dependencias: `numpy requests rasterio pyproj`.
El mapa global se reutiliza desde `LOLA_Terreno/datos`; se necesita conexión para
la primera descarga y los recortes remotos de pendiente. El valor predeterminado
es PPD=64; los ejemplos usan 16 para una descarga menor. El horizonte se calcula
con el mapa global y la pendiente con un DEM de mayor resolución. Los datos
interpolados y el muestreo del horizonte no representan obstáculos subpíxel.

- [Pruebas_COG_LOLA.ipynb](Pruebas_COG_LOLA.ipynb): experimental terrain, horizon and visibility evaluation with remote LOLA/SLDEM2015 data.
- [Execution guide and limitations](Pruebas_COG_LOLA/README.md).
- [Notebook requirements](Pruebas_COG_LOLA/requirements.txt).

**Data:** [NASA PGDA LOLA products](https://pgda.gsfc.nasa.gov/products/90).

## Project rule

- **AI use must be documented:** Record every use of AI in writing so it can be reported. Include what AI was used for and how its output was used in the project.

## Agent skills

Skills available to agents working in this repository:


- **[threejs-r3f](.agents/skills/threejs-r3f/SKILL.md)** — Build and fix React Three Fiber scenes, including Drei helpers, loading, events, and React lifecycle integration.
- **[web-design-guidelines](.agents/skills/web-design-guidelines/SKILL.md)** — Review the interface for accessibility, usability, and Web Interface Guidelines compliance.
