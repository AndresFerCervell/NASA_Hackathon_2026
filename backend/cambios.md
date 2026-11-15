# Cambios del backend local

Actualizado el 15 de noviembre de 2026.

El evaluador devuelve todos los fallos que se pueden determinar con los datos
recibidos. Sigue comprobando iluminación, visibilidad terrestre y duración aunque
la pendiente ya incumpla el límite. El resultado expresa **viabilidad estimada
según los criterios configurados**.

## Diccionario de fallos

La constante `DICCIONARIO_FALLOS` está en `calculos.py`. Cada informe incluye una
copia en `diccionario_fallos`. Al serializar a JSON, sus claves numéricas pasan
a ser cadenas, por ejemplo `"1"`.

| Código | Significado | Condición por defecto |
| --- | --- | --- |
| 1 | Pendiente excesiva para el criterio de aterrizaje. | Pendiente ≥ 15°. |
| 2 | Datos obligatorios ausentes, inválidos o de otro sitio. | Incluye el detalle de todos los problemas de entrada detectados. |
| 3 | Obstrucción inicial por relieve o eclipse. | Sol con elevación > 0° y horizonte del terreno positivo que deja margen ≤ 0,5°, o eclipse del Sol puntual sobre el horizonte horizontal en t0. |
| 4 | Visibilidad directa de la Tierra insuficiente en t0. | Margen de la Tierra sobre el relieve ≤ 0°. |
| 5 | Elevación solar inicial insuficiente para el criterio configurado. | Elevación absoluta del Sol ≤ 5°. |
| 6 | No se alcanza el requisito de luz en el periodo evaluado. | Luz estimada ≤ 50 % de las horas solicitadas, con cobertura completa. |
| 7 | Cobertura temporal insuficiente. | La serie no cubre el periodo solicitado o la duración solicitada es cero. |

Los códigos 2 y 7 indican problemas de datos. Los códigos 3 y 5 evalúan causas
independientes en el aterrizaje. Con horizonte plano y Sol a −2° o a 4° aparece
el 5. Con Sol a 20° y una montaña que eleva el horizonte hasta 25° aparece el 3.
Con Sol a 2° y horizonte a 10° aparecen ambos. El detalle del código 3 contiene
`causas`, con `relieve`, `eclipse` o ambos, y los ángulos usados. El margen de
0,5° sigue siendo un criterio configurable de separación respecto al relieve.

El requisito temporal exige **más del porcentaje configurado** de las horas
solicitadas. Se ha elegido `min_porcentaje_luz=50.0` como valor por defecto.
Para 24 h se exige más de 12 h de luz y exactamente 12 h activa el código 6.
Los códigos 3 y 5 corresponden a t0 y el 6 al total del periodo solicitado.

## Salida del evaluador: contrato versión 2

Ejemplo abreviado de un caso sintético con pendiente excesiva, Sol a −2°,
Tierra a −3° y horizonte plano durante todo el periodo solicitado.

```json
{
  "version_contrato": 2,
  "viable": false,
  "estado": "no_viable",
  "evaluacion_completa": true,
  "fallos": [1, 4, 5, 6],
  "criterios_no_evaluados": []
}
```

Además, cada informe contiene:

- `detalle_fallos`: un objeto por código, con descripción, mensaje y datos técnicos.
- `diccionario_fallos`: todos los códigos y su significado.
- `datos_tecnicos`: métricas calculables, también cuando se rechaza el sitio.
- `parametros_mision`: umbrales empleados.
- `cobertura_temporal`: duración solicitada, observada y suficiencia.
- `modelo`, `metadatos_terreno` y `procedencia_efemerides`.

Interpretación de `viable`:

| Valor | Significado |
| --- | --- |
| `true` | Todos los criterios se han evaluado y superado. |
| `false` | Hay al menos un criterio incumplido. Puede haber también datos faltantes; revisar `evaluacion_completa`. |
| `null` | No se conoce un incumplimiento, pero faltan datos para decidir. `estado` es `datos_insuficientes`. |

`evaluacion_completa` indica que se han podido aplicar todas las reglas del
prototipo. No indica validación física del aterrizaje.

**Cambio de contrato:** se eliminan `fallo`, `paso_fallido`, `motivo_rechazo` y el
centinela `-1`. Sus sustitutos son `fallos` y `detalle_fallos`; éxito usa `[]`.
Un consumidor debe comprobar `viable === true` para aceptar el resultado y tratar
`null` de forma explícita.

## Correcciones implementadas

| Archivo | Corrección |
| --- | --- |
| `calculos.py` | Acumula fallos independientes, valida entradas y distingue datos insuficientes. |
| `calculos.py` | Integra horas por intervalos reales, conserva tiempos fraccionarios y devuelve el intervalo de detección de pérdidas. |
| `calculos.py` | Usa el eclipse de la capa geométrica tanto en t0 como en toda la serie; elimina el umbral angular duplicado de 1,2°. |
| `calculos.py` | Exige efemérides del sitio correcto, unidades y modelo identificados. Sustituye la demostración de varios sitios con una sola serie por una CLI que lee un JSON. |
| `efemerides_lunar.py` | Conserva `tierra_bloquea_sol`, lugar, altura, fuente, unidades, modelo y parámetros temporales. Los offsets no se redondean con los ángulos. |
| `procesar_sitio_lunar.py` | Copia directamente `datos_efemerides["ephemeris"]`, sin el anidamiento erróneo de `timeline`, y conserva t0 UTC. |
| `procesar_sitio_lunar.py` | Conserva metadatos del terreno, exige altura finita y no sustituye pendiente ausente por cero. Mantiene los signos del identificador. |
| `procesar_sitio_lunar.py` | Trabaja en memoria y publica cuatro JSON en una carpeta única por petición. Elimina la escritura duplicada del combinado. |
| `tests/test_landing_evaluation.py` | Añade regresiones del evaluador, generador y orquestador, sin red. |

La validación comprueba campos numéricos finitos, coordenadas y altura del
observador, horizonte de 360 ángulos y tiempos crecientes desde cero. Si se
declara un paso, comprueba que no falten muestras intermedias. Los problemas de
un sitio no impiden procesar los demás. Un contenedor exterior sin diccionario
`sitios` válido produce `ValueError`, porque no hay sitios que puedan informarse.

El acimut `null` solo permite consultar el horizonte cuando la elevación es
exactamente cénit/nadir. En otras direcciones queda como dato insuficiente;
no se sustituye por norte. Los valores no finitos que aparezcan en la procedencia
del informe se representan como `null`, además del diagnóstico de los campos
obligatorios inválidos.

## Duraciones y límites del muestreo

En cada intervalo `[t_i, t_i+1)` se mantiene el estado de la muestra izquierda.
La última muestra no añade duración. Por ello, 49 muestras cada 0,5 h, 25 cada
1 h y 13 cada 2 h representan el mismo intervalo de 24 h.

`primera_perdida_luz` y `primera_perdida_comunicacion` contienen la hora de la
primera muestra sin visibilidad y el intervalo entre esa muestra y la anterior.
Si no se observa pérdida, son `null`; no se inventa un evento al final de la
serie. Una pérdida inicial se informa en `[0, 0]`. La pérdida de luz incluye
eclipses y no equivale necesariamente a una puesta de Sol por relieve.

Las transiciones y los eclipses cortos pueden ocurrir entre muestras. Las horas
son una estimación bajo esa aproximación; reducir el paso puede cambiar el
resultado cuando hay transiciones. Si la duración no es múltiplo del paso,
no se extrapola el tramo final: se informa cobertura incompleta, código 7.

Se mantiene la duración por defecto de 24 h. El requisito se calcula mediante
`horas_solicitadas * min_porcentaje_luz / 100`. La cobertura completa permite
evaluar el criterio también en periodos cortos. Un porcentaje de 100 siempre
activa el código 6 porque se exige superarlo estrictamente.

`datos_tecnicos` incluye `requisito_exclusivo_luz_horas`, `porcentaje_luz`,
`horas_luz_sin_relieve` y `horas_perdidas_por_relieve`. Las horas sin relieve
consideran Sol por encima del horizonte horizontal y ausencia de eclipse.
Las pérdidas por relieve cuentan los intervalos de ese conjunto con margen
solar ≤ 0°. Así se pueden identificar periodos con luz potencial tapada por
montañas. El margen inicial de 0,5° se aplica únicamente al criterio 3.
`porcentaje_luz` divide las horas iluminadas observadas entre las solicitadas.
Si la cobertura es incompleta, ese porcentaje es provisional y el criterio 6
queda sin evaluar.

El total de luz no calcula energía almacenada, temperatura ni continuidad de
recarga. La propuesta para mejorar esta estimación está en [mejoras.md](mejoras.md).

## Uso y persistencia

Desde `backend`, con el entorno del proyecto activo:

```powershell
# Consulta real: puede acceder a Horizons y descargar/leer terreno.
python procesar_sitio_lunar.py --tiempo 2026-11-14T12:00:00Z --lat -89.65 --lon 129.2 --horas 336 --min-porcentaje-luz 50

# Reevalúa un combinado con el nuevo contrato, sin consultar fuentes externas.
python calculos.py datos_lunares/peticion_ID/datos_lunares.json --min-porcentaje-luz 50
```

La función devuelve `terreno`, `efemerides`, `combinado`, `evaluacion` y las rutas.
`carpeta_salida=None` devuelve todo en memoria. Se puede pasar un
`LandingSiteEvaluator` mediante `evaluador=` para configurar los criterios.

```python
evaluador = LandingSiteEvaluator(min_porcentaje_luz=75)
```

Las llamadas anteriores que pasan explícitamente `min_horas_supervivencia`
conservan un requisito en horas absolutas, que tiene prioridad sobre el
porcentaje. Su valor por defecto es ahora `None`, que activa el porcentaje.
`datos_tecnicos.requisito_exclusivo_luz_horas` declara el umbral aplicado.

Cada ejecución persistida usa `datos_lunares/peticion_<uuid>/`. Al comenzar,
la nueva petición válida elimina las carpetas `peticion_*`, los temporales
`.incompleta-*` y los cuatro JSON del formato antiguo en la raíz de salida.
Después calcula y escribe los cuatro archivos en un directorio temporal,
que renombra completo al terminar. Si falla el cálculo o la escritura, los
resultados anteriores ya se han eliminado y no se publica una carpeta parcial.
Los consumidores deben usar las rutas devueltas. Los parámetros inválidos se
rechazan antes de limpiar. El modo `carpeta_salida=None` trabaja en memoria.
El fichero auxiliar `.peticion.lock` coordina hilos y procesos durante toda la
petición. Una petición simultánea sobre la misma carpeta recibe un error y puede
reintentarse al terminar la activa. El sistema libera el bloqueo al salir del
proceso, incluso ante una interrupción. Una carpeta `.incompleta-*` abandonada
se elimina con la siguiente petición válida.

Para varios sitios, la entrada utiliza `ephemeris_por_sitio`, indexado con las
mismas claves que `sitios`. El campo común `ephemeris` solo se admite cuando
hay un sitio. Cada serie necesita `lugar`, `fuente`, `unidades`, `modelo`,
`duracion_solicitada_horas`, t0 y las muestras con su booleano de eclipse.

Los JSON históricos del repositorio no se han sobrescrito. No contienen todos
estos campos y algunos conservan el anidamiento antiguo: deben regenerarse para
una evaluación completa. El endpoint `/api/lunar-geometry` sigue ofreciendo
geometría; no se ha conectado a este orquestador ni se ha cambiado su contrato.

## Verificación y alcance

Comando desde `backend`:

```powershell
..\.venv\Scripts\python.exe -B -m unittest discover -s tests -v
```

Resultado del 15 de noviembre de 2026, **62 pruebas superadas**, incluidas las
regresiones de terreno P95. Comprueba fallos simultáneos, aprobación, límites exactos,
pasos de 0,5/1/2 h, eventos fraccionarios, eclipse inicial, extremos, cobertura
incompleta, validación, independencia entre sitios y persistencia sin mezclas.
Incluye independencia de los códigos 3 y 5, horas de sombra por relieve,
porcentajes 0/25/50/75/100, igualdad con el umbral y porcentaje personalizado
en el informe persistido.

Se utilizan fixtures sintéticas y mocks; no se han descargado DEM ni generado
nuevas efemérides reales. No se atribuye a estas pruebas validación científica
de la resolución del terreno, conversión completa del datum vertical o del
comportamiento de un vehículo. El cálculo del terreno y las cuatro consultas
secuenciales internas de Horizons se mantienen.

Uso de IA: Codex ha implementado las correcciones, escrito las pruebas y redactado
estos documentos a partir de las instrucciones y objetivos del equipo. Las
propuestas de `mejoras.md` quedan documentadas para revisión, sin activar nuevos
umbrales de misión.
