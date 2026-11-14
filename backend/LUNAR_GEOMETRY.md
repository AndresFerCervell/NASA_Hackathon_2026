# Geometría lunar desde el frontend

`POST /api/lunar-geometry` recibe el lugar y el tiempo del frontend. Devuelve las mismas
posiciones, ángulos, distancias, iluminación y visibilidad terrestre que el notebook.
El cálculo está en `app/astronomy/lunar_geometry.py`; el contrato y la ruta en `app/lunar_api.py`.
El notebook importa ese mismo módulo para evitar dos implementaciones.

## Arranque

Desde la raíz, con Python 3.12 y un entorno virtual activado:

```sh
python -m pip install -r backend/requirements.lock
python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 3001 --workers 1
```

Documentación interactiva: `http://localhost:3001/docs`. El backend existente y sus rutas
se conservan. Este endpoint usa Horizons y no necesita descargar el kernel de Skyfield.
El proxy de Vite ya dirige `/api` al backend.

## Entrada JSON

```json
{
  "lugar": {
    "nombre": "Apolo 11",
    "latitud_deg": 0.67416,
    "longitud_deg": 23.47314,
    "altura_m": 0.0
  },
  "inicio_utc": "1969-07-20T20:17:40Z",
  "duracion_segundos": 0,
  "paso_segundos": 600
}
```

Apolo 11 es un ejemplo, no una constante del servicio. La latitud positiva es norte y la
longitud positiva este. La altura está en **metros sobre la superficie de referencia lunar
de Horizons**, no sobre el terreno local. Se aceptan latitudes [-90,90], longitudes [-180,360]
y alturas [-20000,100000] m. La altura cero del ejemplo es una suposición.

`inicio_utc` debe tener zona (`Z` u offset) y segundos enteros, entre 1962 y 2100 inclusive.
`duracion_segundos` es un entero de 0 a 366 días. Cero consulta un instante; para una serie
usa por ejemplo 21600 (6 horas). `paso_segundos` es un entero múltiplo de 60. La duración
positiva debe ser al menos un paso. Máximo 10000 muestras, sin rellenar filas inexistentes.
El final solo se incluye si coincide con el paso.

## Uso desde TypeScript

```ts
import { fetchLunarGeometry } from './api/lunarGeometryClient';

const response = await fetchLunarGeometry({
  lugar: {
    nombre: 'Lugar seleccionado',
    latitud_deg: selectedLatitude,
    longitud_deg: selectedLongitude,
    altura_m: selectedHeightMetres,
  },
  inicio_utc: new Date(Math.floor(selectedDate.getTime() / 1000) * 1000).toISOString(),
  duracion_segundos: durationSeconds,
  paso_segundos: stepSeconds,
}, abortController.signal);

const samples = response.datos;
```

El cliente está preparado para conectar con el formulario/mapa; esta entrega no añade una
nueva pantalla. Redondea o elimina los milisegundos de la fecha antes de enviarla: por ejemplo,
`new Date(Math.floor(selectedDate.getTime() / 1000) * 1000).toISOString()`.
La cancelación aborta la espera del navegador; una consulta ya iniciada en el backend termina
o agota su plazo antes de liberar el acceso a Horizons. No dispares consultas en cada frame:
usa una acción explícita del usuario o debounce.

## Respuesta

El objeto incluye `lugar`, intervalo, `total_muestras`, `fuente`, `marco`, `unidades`, `modelo`
y `datos` (una lista de filas). Cada fila contiene:

- `tiempo_utc`, `t_segundos`.
- `tierra_x_km`, `tierra_y_km`, `tierra_z_km`, `sol_x_km`, `sol_y_km`, `sol_z_km`.
- `distancia_tierra_km`, `distancia_sol_km`.
- `elevacion_*_deg`, `acimut_*_deg`, `angulo_normal_*_deg`, para Tierra y Sol.
- `sol_sobre_horizonte`, `tierra_bloquea_sol`, `iluminado_sin_terreno`, `iluminado`.
- `tierra_visible`, `conexion_tierra`.

Todos los vectores parten del lugar y terminan en el centro del cuerpo, en **km / ICRF**.
Elevación respecto al horizontal local; acimut horario desde el norte lunar (N=0, E=90,
S=180, W=270); theta = 90 - elevación. Un acimut indefinido se representa como `null`.
Las horas se normalizan a UTC. Los booleanos son booleanos JSON.

`conexion_tierra` significa centro de la Tierra por encima del horizontal, no un enlace
radio garantizado o visibilidad de una estación concreta. La iluminación usa un Sol puntual,
Tierra esférica de radio 6371 km y horizonte local de la Luna de referencia. No incluye relieve,
disco solar, eclipses parciales, atmósfera, luz reflejada ni depresión del horizonte por altura.
La orientación y el horizonte del terreno deben aplicarse en el siguiente módulo.

## Operación y errores

- `422`: parámetros inválidos, antes de contactar con Horizons.
- `502`: fallo HTTP/JSON de Horizons o tabla incompleta/inválida; no se inventan muestras.
- `503`: ya hay una consulta; cabecera `Retry-After: 5`.
- `504`: timeout de Horizons. El presupuesto total es 90 s, con tiempos de conexión/lectura
  acotados; la detección puede demorarse hasta la lectura en curso.

Las cuatro peticiones a Horizons son secuenciales. Hay un bloqueo por proceso para evitar
consultas paralelas según la política SSD. Usa **un worker y una instancia**; para escalar
hay que compartir el limitador entre procesos/instancias. El servidor necesita salida HTTPS
a `ssd.jpl.nasa.gov`. El cliente no puede cambiar la URL ni los parámetros internos de Horizons.
Las respuestas están limitadas a 32 MiB por petición upstream y no se reintentan automáticamente.

Configura `CORS_ORIGINS` con los dominios de frontend separados por comas. Por defecto permite
`http://localhost:5173,http://localhost:3000`, sin credenciales. En producción sirve frontend
y API por HTTPS; aplica autenticación/cuotas en tu gateway si el despliegue es privado o
multiusuario. La API no incorpora identidad de usuarios. No se ha desplegado este servicio.

Pruebas deterministas, sin red ni descarga de kernels:

```sh
python -m pip install -r backend/requirements-dev.txt
# Desde backend:
python -m unittest discover -s tests -v
```

Fuentes: [Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html),
[política SSD](https://ssd-api.jpl.nasa.gov/doc/),
[convenciones de Horizons](https://ssd.jpl.nasa.gov/horizons/manual.html).
