# Propuesta para estimar la viabilidad operativa

Fecha: 14 de noviembre de 2026. Propuesta pendiente de implementación.

## Medir la oscuridad continua y la pérdida continua de visibilidad terrestre

La mejora más sencilla con nuestros datos es añadir **la duración del tramo más
largo sin luz** y **la duración del tramo más largo sin visibilidad terrestre**
dentro del periodo de misión. Ya tenemos el horizonte local, la elevación y el
acimut del Sol y la Tierra, el estado de eclipse y los tiempos de las muestras.
No requiere otro dataset ni un modelo térmico inventado.

Sumar horas de luz no distingue cómo se distribuyen. Por ejemplo, en un periodo
de 48 h, 24 h seguidas de oscuridad y 24 intervalos de oscuridad de 1 h suman la
misma duración, pero exigen reservas y operación distintas. Este ejemplo es
sintético y no implica que una hora de luz recargue la batería.

## Cálculo propuesto

1. Elegir el periodo de misión y comprobar que la serie lo cubre completo.
2. Para cada muestra, calcular `luz = margen_sol > 0 y no eclipse` y
   `tierra_visible = margen_tierra > 0`, usando el mismo modelo que el evaluador.
3. Recorrer los intervalos temporales reales y agrupar estados consecutivos.
   Sumar sus duraciones, sin asignar una hora ficticia a la última muestra.
4. Devolver la máxima oscuridad continua, la máxima pérdida de visibilidad
   terrestre, sus inicios y finales, y el paso temporal máximo empleado.
5. Marcar los tramos que empiezan o terminan en los extremos del periodo: solo
   conocemos su duración dentro de la ventana, no su duración física completa.

Campos sugeridos:

```text
max_oscuridad_continua_h
max_sin_visibilidad_tierra_h
tramos_oscuridad: [{inicio_h, fin_h, duracion_h, limitado_por_ventana}]
tramos_sin_visibilidad_tierra: [{inicio_h, fin_h, duracion_h, limitado_por_ventana}]
paso_maximo_h
```

Serían métricas útiles para comparar sitios y fechas aun sin conocer el módulo.
Conviene mostrarlas junto con pendiente, márgenes de visibilidad y total de luz,
sin convertirlas en una puntuación única con pesos arbitrarios.

## Cuándo permitirían rechazar una opción

Si el equipo aporta una autonomía máxima sin Sol validada para el vehículo,
podemos comparar la oscuridad continua con ese límite. Si la supera, se
incumple esa condición de misión. Si no la supera, solo se supera ese filtro:
todavía faltan estado inicial de carga, consumo y recarga durante las ventanas
iluminadas para estimar el balance energético completo.

Lo mismo se aplica a un máximo permitido sin comunicación directa, si la misión
lo exige. La visibilidad del centro de la Tierra es una condición geométrica;
para afirmar enlace real faltan la estación, antenas y presupuesto de enlace.
Un relé orbital cambiaría el criterio y necesitaría sus propias efemérides.

Con los datos actuales proponemos informar estos tiempos y los márgenes
geométricos. **Sin los parámetros del vehículo no se debe asignar un umbral
numérico nuevo ni concluir supervivencia térmica o energética.**

## Cómo comprobar que la estimación es estable

Comparar la misma ventana con pasos de 60, 30 y 10 minutos, manteniendo el mismo
terreno y reglas. Revisar cuánto cambian las máximas duraciones y las transiciones.
Estos pasos son una propuesta de muestreo para el prototipo, no requisitos
operativos validados. Si cambian la decisión cerca de un límite, refinar y
presentar el caso como incierto hasta resolverlo.

La integración por muestra izquierda aproxima la transición dentro de cada
intervalo. Puede perder episodios enteros entre muestras, por lo que un paso
pequeño no garantiza por sí solo un error máximo de un paso. Conservar los
intervalos de detección y contrastar resultados con un muestreo más fino.

La incertidumbre espacial es independiente de la temporal. El backend actual
usa por defecto PPD=16 para el horizonte, unos 1,9 km de espaciado norte-sur,
y un producto más fino para la pendiente. Refinar el tiempo no revela un
obstáculo que no aparece en ese horizonte. Para sitios polares prioritarios,
la mejora posterior sería recalcular el horizonte con un DEM adecuado y
contrastar la resolución efectiva y el error del producto. NASA publica esas
capas por separado del DEM. [Productos LOLA de NASA PGDA](https://pgda.gsfc.nasa.gov/products/90).

Antes de una validación física también debe comprobarse el datum vertical
al pasar alturas del terreno a Horizons. El manual documenta las coordenadas
lunares Mean Earth de DE421 y la altura respecto a la superficie de referencia;
esa documentación no sustituye una comprobación de la conversión con nuestros
productos concretos. [Manual de JPL Horizons](https://ssd.jpl.nasa.gov/horizons/manual.html).

Esta propuesta se deriva de los campos disponibles en nuestro código. Las
fuentes citadas describen los productos y convenciones; no validan un umbral de
autonomía ni la supervivencia de una misión.
