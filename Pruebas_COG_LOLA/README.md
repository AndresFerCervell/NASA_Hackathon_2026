# Pruebas_COG_LOLA

Notebook autocontenido en `../Pruebas_COG_LOLA.ipynb` para experimentar con evaluación topográfica lunar y preparar funciones extraíbles a un futuro backend. No implementa frontend ni API propia.

## Ejecutar

Desde la raíz del repositorio, con Python 3.12 o superior:

```powershell
python -m venv .venv-lola
.\.venv-lola\Scripts\python.exe -m pip install -r Pruebas_COG_LOLA\requirements.txt
.\.venv-lola\Scripts\python.exe -m ipykernel install --user --name pruebas-lola --display-name "Python (Pruebas LOLA)"
.\.venv-lola\Scripts\python.exe -m jupyterlab Pruebas_COG_LOLA.ipynb
```

También se puede abrir directamente en VS Code y elegir el intérprete de ese entorno. No es necesario registrar un kernel si VS Code detecta el entorno. Selecciona el kernel adecuado y ejecuta todas las celdas en orden. No necesitas el backend ni el frontend.

La primera celda de código contiene coordenadas, UTC, tamaños, umbrales, modo de efemérides y controles de ejecución. Los umbrales son experimentales. Los azimuts manuales son ejemplos y no representan la geometría de Apolo 11. Para consultar posiciones reales utiliza `EPHEMERIS_MODE = "horizons"`.

La ejecución normal verifica los algoritmos con terrenos sintéticos, analiza cinco ventanas reales pequeñas, consulta Horizons y mide una lectura COG parcial. Incluye un perfil real local limitado a 5 km, marcado como truncado, y compara altura, distancia y paso radial sin interpretarlo como horizonte completo. Los horizontes extensos, el barrido de 360°, la serie temporal y su sensibilidad quedan disponibles mediante los parámetros `RUN_*`. Un paso de 0,5° genera 720 perfiles y puede ser costoso. La búsqueda completa tiene un límite geométrico condicionado a una envolvente de altura, no un corte fijo de 100 km.

Para volver a ejecutar y conservar salidas:

```powershell
python Pruebas_COG_LOLA/validar_notebook.py
```

Ese comando usa el kernel `python3`; ejecútalo desde el entorno con las dependencias instaladas. El archivo `validacion.json` registra las celdas ejecutadas y los errores. Las salidas del notebook distinguen pruebas aprobadas, datos reales obtenidos, fallos de acceso y experimentos desactivados.

## Fuentes oficiales

- [PGDA producto 90](https://pgda.gsfc.nasa.gov/products/90): DEM COG polares, pendiente, incertidumbre vertical, resolución efectiva y rugosidad a distintas bases.
- [PGDA producto 78](https://pgda.gsfc.nasa.gov/products/78): mapas de 5 m de sitios del polo sur, incluido Shackleton. Un GeoTIFF no se considera automáticamente COG.
- [Imbrium / SLDEM2015](https://imbrium.mit.edu/DATA/SLDEM2015/TILES/FLOAT_IMG/): tiles PDS LBL + IMG a 512 ppd, usados como alternativa de acceso parcial para Apolo 11 y latitudes medias.
- [PGDA producto 67](https://pgda.gsfc.nasa.gov/products/67): pendiente/azimut derivados de SLDEM2015; información de soporte, no un DEM COG.
- [PDS Geosciences LOLA](https://pds-geosciences.wustl.edu/missions/lro/lola.htm): catálogo y documentación.
- [Barker et al., manuscrito NASA](https://ntrs.nasa.gov/api/citations/20205009660/downloads/Mike%20Barker_%20Paper_%20Improved%20Lola.pdf?attachment=true): estrategia de horizonte multirresolución verificada en la sección 4.
- [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/manual.html) y [documentación API](https://ssd-api.jpl.nasa.gov/doc/horizons.html): efemérides del observador lunar.
- [NASA NSSDCA Apolo 11](https://nssdc.gsfc.nasa.gov/planetary/lunar/apollo11info.html), [NASA historial](https://www.nasa.gov/wp-content/uploads/static/history/SP-4029/Apollo_11a_Summary.htm) y [LROC](https://www.lroc.im-ldi.com/featured_sites/apollo-11/temporal-traverse): comparación de coordenadas y cronología.

Los enlaces de archivo se descubren en las páginas oficiales y se comprueban con HTTP Range. No se descargan modelos completos. La instrumentación COG mide los bytes de cuerpo HTTP de una ventana con un proxy temporal en localhost, que se cierra al finalizar. No mide todo el tráfico del notebook.

## Referencias y limitaciones

Latitud planetocéntrica, longitud positiva este, esfera de 1 737 400 m, marco documental MOON_ME/DE421. Las alturas PGDA están en metros; los DN SLDEM2015 están en kilómetros sobre esa esfera y se convierten sin sumar el offset radial. La rejilla de cálculo local utiliza AEQD en metros. Se informa la discrepancia posible entre el marco de efemérides Horizons actual y DE421.

El tamaño de píxel no garantiza resolución efectiva. Cuando no existe EFFRES o ERR se conserva esa incógnita. Los huecos, límites de tiles y regiones no cubiertas permanecen como NoData. No se rellenan con terrenos sintéticos ni se aumenta artificialmente la resolución. El catálogo implementado no cubre el polo norte ni todas las posibles fuentes oficiales: un resultado sin cobertura se refiere a este catálogo.

La rugosidad y la pendiente dependen de la escala. La máscara de depresiones no confirma cráteres. Los DEM promediados pueden perder picos; el máximo por bloque sólo es conservador respecto a las muestras nativas ya leídas y no constituye por sí solo una cota angular del horizonte. Los rayos discretos tampoco garantizan detectar obstáculos entre azimuts. El notebook informa visibilidad del modelo y mantiene indeterminada la física cuando no puede acotar esos errores.

Las series temporales, si se activan, usan retención de muestra y muestran el paso temporal; las duraciones no son tiempos de cruce exactos. La visibilidad del centro terrestre no evalúa comunicaciones por radio. El índice parcial y la confianza son heurísticos separados: no representan probabilidad de aterrizaje seguro ni certificación NASA.

La memoria medida por `tracemalloc` es sólo memoria Python; se registra aparte el tamaño de matrices. El tráfico GDAL global no se presenta como si estuviera medido por Requests. La auditoría conserva metadatos, cobertura documental y rectangular real, overviews, NoData y resultados de transporte.

## Validación durante la creación

Se aprobaron 17 grupos de pruebas sintéticas y pruebas adicionales de integración del perfil, del horizonte sobre una esfera y del adaptador temporal. Se obtuvieron elevaciones reales en las cinco regiones y efemérides del Sol y la Tierra para Apolo 11. El caso de Apolo 11 usa píxeles de unos 59,23 m: no cumple el objetivo inicial de 20 m para obstáculos de 100 m con cinco píxeles por obstáculo.

La primera medición instrumentada transfirió 786 432 bytes de un COG de 218 961 039 bytes (0,36 %). El registro se conserva en `verificacion_acceso_parcial.json`. La repetición de algunas lecturas de PGDA produjo HTTP 403 y errores de lectura en bandas auxiliares: se dejan registrados en las salidas, con esas propiedades como desconocidas. Ese registro previo no sustituye los resultados de una nueva ejecución ni presupone disponibilidad futura del servidor.

`sondeo_fuentes.json` conserva la inspección inicial de tres archivos y `Apolo11.LBL.txt` la etiqueta oficial consultada. `probar_adaptadores.py` comprueba un perfil real y Horizons; usa después una esfera sintética explícita para probar el cierre y las series sin hacer un barrido remoto extenso. Las pruebas sintéticas del notebook no requieren red.
