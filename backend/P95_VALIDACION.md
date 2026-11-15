# Pendiente P95: implementación y validación

Fecha: 14 de noviembre de 2026.

Nota del 15 de noviembre de 2026. Las mediciones y los resultados de este
documento corresponden a las reglas de iluminación vigentes el día 14.
El evaluador actual distingue obstrucción por relieve de elevación solar baja
y exige por defecto más del 50 % de las horas solicitadas con luz. Las reglas
actualizadas se describen en [cambios.md](cambios.md).

## Comportamiento

El terreno exporta `pendiente_p95_deg`, calculado con
`np.percentile(pendientes[dentro], 95, method="linear")`, sobre los centros de
píxel situados dentro del mismo círculo geodésico usado por el máximo (200 m
de radio por defecto). Se calcula tanto para el GeoTIFF polar/local como para
los tiles cilíndricos. Se conserva `pendiente_deg` como máximo informativo.
La función `pendiente_maxima_local` conserva su retorno máximo/metadatos;
el nuevo P95 se incorpora a esos metadatos y al JSON de `calcular_terreno`.

El orquestador pasa el P95 al evaluador. El criterio de pendiente exige
`pendiente_p95_deg < max_pendiente_deg` (15 grados por defecto; igualdad falla).
En `datos_tecnicos.criterio_pendiente` se declara el campo evaluado.
Los JSON antiguos sin P95 conservan el criterio anterior basado en el máximo;
para aplicar P95 a esos sitios hay que recalcular el terreno. Si el campo P95
está presente pero es inválido, se registra un error de datos: no se sustituye
por el máximo ni por cero. Se mantiene el contrato previo de evaluación
incompleta, incluido `viable: null` cuando no hay un rechazo conocido.

P95 reduce la influencia del extremo superior de la distribución, pero esos
valores pueden ser relieve real. No garantiza la ausencia de obstáculos ni
equivale a una probabilidad de aterrizaje seguro. Los demás criterios de luz,
comunicación y cobertura temporal conservan su comportamiento.

## Pruebas

Desde `backend`, con el entorno de la raíz:

```powershell
..\.venv\Scripts\python.exe -m unittest discover -s tests
```

La suite cubre aceptación con P95 y máximo elevado, rechazo desde 15 grados,
P95 inválido, compatibilidad antigua, transporte y persistencia del P95,
DEM polar con pico aislado, plano inclinado, datos ausentes y tile cilíndrico.
También incluye las regresiones anteriores de evaluación, integración y API.
Las pruebas automáticas usan datos sintéticos y respuestas simuladas, sin red.
Resultado final: **53 pruebas superadas en 1,609 s**, sin fallos. El aviso de
deprecación del cliente de pruebas FastAPI/Starlette ya estaba presente.
Se ejecutó además la CLI `calculos.py` cinco veces con un JSON sintético de
337 muestras, validando el JSON devuelto y la aceptación por P95.

## Tiempos medidos

Mediciones locales con `time.perf_counter`, Python 3.12 y el entorno del proyecto.
El tiempo interno del evaluador excluye imports, construcción de los datos y
escritura a disco. Se usaron 100 repeticiones por configuración sintética:

| Evaluación | Muestras | Mediana | P95 del tiempo |
| --- | ---: | ---: | ---: |
| 24 h, paso 1 h | 25 | 0,466 ms | 0,641 ms |
| 336 h, paso 1 h | 337 | 2,619 ms | 4,075 ms |
| 336 h, paso 10 min | 2017 | 15,033 ms | 17,703 ms |

Calcular únicamente el percentil de 1256 valores tardó 0,052 ms de media
en 1000 repeticiones. Ejecutar la CLI completa de `calculos.py` con 337 muestras
tardó 0,276 s de mediana (rango 0,247–0,336 s, cinco procesos nuevos), incluyendo
arranque del intérprete, lectura del JSON y serialización del informe.

También se midió el flujo terreno → efemérides → evaluación, en memoria,
para (-89,65; 129,2), inicio 2026-11-14T12:00:00Z, paso de una hora, PPD=16
y radio de pendiente de 200 m. LOLA polar y JPL Horizons se consultaron realmente.
Se reutilizó el LDEM_16 de 33 177 600 bytes ya descargado en la raíz: se abrió
como memmap y se inyectó en `cargar_lola` con la escala de su etiqueta PDS.
No se modificó la ruta de caché del código ni se guardaron nuevos resultados
científicos. No se incluyen imports ni persistencia en estos tiempos:

| Ejecución | Terreno | Efemérides | Total |
| --- | ---: | ---: | ---: |
| Primera, 24 h | 3,654 s | 1,624 s | 5,280 s |
| Segunda, 336 h | 0,116 s | 2,088 s | 2,208 s |
| Tercera, 336 h | 0,117 s | 2,430 s | 2,550 s |

El ahorro posterior del terreno incluye reutilización de caché de lectura
remota dentro del proceso. No permite atribuir toda la diferencia a la duración
de las efemérides. Para un proceso ya iniciado y con el DEM disponible, una
estimación inicial es de 2–6 s por sitio en estas condiciones de conexión;
no es un límite garantizado ni una medición del servidor de despliegue.
La primera descarga del DEM, los fallos de red y los reintentos pueden aumentar
el tiempo. El backend utiliza su propia carpeta `LOLA_Terreno/datos`: disponer
del IMG en la raíz no evita por sí solo que una ejecución normal lo descargue
en la carpeta del backend. La medición reutilizó expresamente la copia existente.

## Resultado real observado

En ese sitio, el máximo es 18,049565 grados y P95 es 12,187394 grados:
supera el nuevo filtro de pendiente. La evaluación completa sigue siendo
`no_viable` para el instante probado: con 336 h devuelve fallos 3, 4, 5 y 6
(luz inicial, visibilidad terrestre, elevación solar y total de luz).
Con 24 h devuelve 3, 4, 5 y 7; la cobertura por defecto no permite comprobar
el requisito de más de 120 h de luz. Esto no implica un error de ejecución.

Uso de IA: Codex implementó el cambio, añadió y ejecutó pruebas y realizó las
mediciones a petición del usuario. No se afirma una validación física del módulo.
