# Lunar Landing Site Navigator

Proyecto NASA Space Apps 2026: evaluación geométrica de sitios lunares con
topografía LOLA y efemérides JPL Horizons, junto con un explorador 3D.

## Organización y recorrido del código

```text
backend/
  evaluar.py                    Entrada única para calcular o reevaluar
  app/
    terrain.py                  Elevación, pendiente y horizonte LOLA
    evaluation.py               Reglas e informe de fallos
    astronomy/
      lunar_geometry.py         Horizons y serie temporal de evaluación
      ephemeris.py              Órbitas Skyfield para la API visual
    main.py                     FastAPI y rutas orbitales
    lunar_api.py                Contrato HTTP de geometría lunar
  tests/                        Pruebas sin red
  requirements.txt              Dependencias directas de todo el backend
  requirements.lock             Versiones resueltas para Python 3.12
  requirements-dev.txt           Dependencias de pruebas
  data/                         Descargas locales; ignoradas
  results/                      Última evaluación; ignorada
  local/legacy/                 Experimentos anteriores locales; ignorados
frontend/
  src/api/                      Clientes HTTP
  src/astronomy/                Cálculos y datos de la visualización
  src/components/               Escenas y componentes React
AI_use.md                       Registro de uso de IA
challenge.md                    Contexto del reto
```

Los Markdown de `backend` son documentación local ignorada por Git. Las carpetas
`data`, `results` y `local` tampoco se distribuyen. El cálculo necesita cuatro
módulos de producción, que conviene leer en este orden:

| Archivo | Función |
| --- | --- |
| `backend/evaluar.py` | Valida fecha, coordenadas y muestreo; coordina terreno → efemérides → evaluación; construye el combinado y guarda la última petición. Contiene la única CLI. |
| `backend/app/terrain.py` | Abre el LDEM global como memmap e interpola la altura. Estima el horizonte en 360 acimuts con curvatura lunar y pendientes Horn 3×3 con máximo/P95 en un círculo de 200 m por defecto. |
| `backend/app/astronomy/lunar_geometry.py` | Consulta Horizons secuencialmente, valida tablas, transforma vectores a elevación/acimut y detecta eclipses geométricos. `generar_efemerides` adapta la tabla al contrato del evaluador. |
| `backend/app/evaluation.py` | Valida que la serie corresponda al sitio, aplica criterios e integra estados sobre intervalos. Devuelve todos los fallos evaluables y distingue rechazo de datos insuficientes. No consulta servicios ni escribe archivos. |

Primero se obtiene el terreno porque las efemérides necesitan la altura del
sitio. La integración usa el estado de la muestra izquierda en cada intervalo;
la última muestra no añade duración.

Las reglas conservan P95 de pendiente menor que 15°, visibilidad terrestre
inicial sobre el horizonte del terreno, elevación solar inicial mayor que 5° y
detección inicial de obstrucciones solares por relieve o eclipse. La luz acumulada
debe superar el **50 % de las horas solicitadas** por defecto, configurable con
`--min-porcentaje-luz`. Los JSON antiguos sin P95 usan el máximo y lo declaran;
un P95 presente pero inválido es un error de datos.

`viable` puede ser `true`, `false` o `null` cuando falta información para decidir.
El informe incluye `fallos`, `detalle_fallos` y `diccionario_fallos`. Estos filtros
no certifican un aterrizaje seguro ni incluyen un modelo térmico o de descenso.

## Instalación y evaluación

Desde la raíz, con Python 3.12. En PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.lock
```

Si ya existe `.venv`, basta con activarlo. En Linux/macOS usa
`source .venv/bin/activate`. Los comandos siguientes usan ese mismo entorno.

```sh
python backend/evaluar.py --tiempo 2026-11-15T12:00:00Z --lat -89.65 --lon 129.2 --horas 24 --paso-horas 1
python backend/evaluar.py --help
```

La primera ejecución descarga el DEM global si falta en `backend/data/lola`.
Las pendientes de alta resolución y las efemérides requieren acceso a LOLA y
Horizons. Fuera de la cobertura automática se necesita un GeoTIFF compatible
pasado a `calcular_terreno(dem_local=...)`; los polos exactos no están admitidos.

La salida se guarda en `backend/results/peticion_<id>/`:

| Archivo | Contenido |
| --- | --- |
| `terreno.json` | Altura, pendiente máxima/P95, horizonte y procedencia |
| `efemerides.json` | Instante, lugar y serie temporal del Sol y la Tierra |
| `datos_lunares.json` | Entrada combinada del evaluador |
| `evaluacion.json` | Decisión, fallos, métricas y cobertura |

Cada petición válida elimina los resultados anteriores de su carpeta de salida
antes de calcular. Un bloqueo evita escritores simultáneos y no se publica una
carpeta parcial si falla el cálculo. `--carpeta` permite elegir la salida.

Para reevaluar un combinado sin consultar servicios ni modificar resultados:

```sh
python backend/evaluar.py --entrada backend/results/peticion_ID/datos_lunares.json
```

Ese comando imprime el informe en JSON. Desde Python se puede importar
`procesar_peticion_frontend` de `evaluar`; `carpeta_salida=None` evita persistir.

## API y explorador 3D

Se conservan tres módulos adicionales para las API existentes:

| Archivo | Responsabilidad |
| --- | --- |
| `backend/app/main.py` | FastAPI, CORS, `/api/health`, `/api/ephemeris`, `/api/trajectory` y registro del router lunar. |
| `backend/app/lunar_api.py` | Modelos Pydantic, `POST /api/lunar-geometry`, bloqueo de consultas simultáneas y errores HTTP. |
| `backend/app/astronomy/ephemeris.py` | Órbitas Sol-Tierra-Luna con Skyfield/DE440s. Descarga el kernel a `backend/data` cuando se necesita. No interviene en la evaluación del sitio. |

Los `__init__.py` marcan paquetes Python y no ejecutan cálculos.

```sh
python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 3001 --workers 1
```

Contratos interactivos: `http://localhost:3001/docs`.
`POST /api/lunar-geometry` devuelve geometría **sin terreno ni evaluación**.
El flujo completo se ejecuta mediante `evaluar.py`; la pantalla actual aún no lo
llama. El bloqueo HTTP es local al proceso: usar un worker/instancia.

Ejemplo de petición de geometría:

```json
{
  "lugar": {"nombre": "Apolo 11", "latitud_deg": 0.67416, "longitud_deg": 23.47314, "altura_m": 0},
  "inicio_utc": "2026-11-15T12:00:00Z",
  "duracion_segundos": 86400,
  "paso_segundos": 3600
}
```

Con Node.js/npm instalado y el entorno Python activado:

```sh
npm install
npm run dev
```

También existen `npm run evaluate -- --lat ... --lon ...`, `npm run test:backend`
y `npm run build`. Vite dirige `/api` al puerto 3001. `CORS_ORIGINS` configura
los orígenes HTTP permitidos. El frontend mantiene sus cálculos visuales en TypeScript.

## Pruebas

```sh
python -m pip install -r backend/requirements-dev.txt
cd backend
python -B -m unittest discover -s tests
```

| Archivo | Qué comprueba |
| --- | --- |
| `test_landing_evaluation.py` | Reglas, porcentajes, duraciones, datos inválidos, integración, persistencia, limpieza y bloqueo. |
| `test_terrain_p95.py` | Planos/picos sintéticos, GeoTIFF, tiles cilíndricos y rechazo sin cobertura. |
| `test_lunar_api.py` | Contrato HTTP, límites/errores de Horizons, geometría y eclipses con respuestas simuladas. |

Las pruebas no descargan DEM ni kernels ni validan la precisión científica remota.

## Scripts retirados y migración

| Archivo anterior | Destino o motivo |
| --- | --- |
| `backend/procesar_sitio_lunar.py` | Sustituido por `backend/evaluar.py`. |
| `backend/calculos.py` | Reglas en `app/evaluation.py`; CLI unificada como `evaluar.py --entrada`. |
| `backend/LOLA_Terreno/terreno_lola.py` | Movido a `app/terrain.py`; retirados CLI independiente y `pendiente_pixel`, sin llamadas. |
| `backend/efemerides_lunar.py` | Adaptador incorporado a `lunar_geometry.py`; eliminada CLI duplicada. |
| `backend/LOLA/lecturaTIF.py` | Experimento con dos sitios fijos y valores manuales de Apolo 11, sin uso en el flujo actual. Archivado localmente. |
| `backend/PRUEBAS.ipynb`, `backend/LOLA_Terreno/Terreno_LOLA.ipynb` | Exploración interactiva. Archivados localmente. |
| JSON de ejemplo y `backend/datos_lunares/` | Resultados generados retirados de Git; nueva salida en `results/`. |
| `main.py` raíz | Saludo de plantilla; archivado localmente. |
| `backend/pyproject.toml`, `uv.lock` | Configuración experimental redundante e incompleta para la API. Archivada; dependencias unificadas en `requirements.txt` y su bloqueo. |

Se conservan cuatro módulos para evaluar y tres para las API, además de pruebas
y marcadores de paquete. Las rutas de ejecución/importación antiguas deben
migrarse. Los originales están en `backend/local/legacy` únicamente en esta copia;
el historial Git conserva las versiones publicadas anteriores.

## Uso de IA

Todo uso de IA debe registrarse en [AI_use.md](AI_use.md), indicando su propósito
y cómo se incorporó la salida. El código usa productos LOLA PDS/PGDA y JPL
Horizons; la API orbital usa DE440s mediante Skyfield.
