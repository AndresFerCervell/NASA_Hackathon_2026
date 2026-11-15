# Este documento consiste en un análisis de la UX de Lunar Landing Site Navigator

**Puntos a analizar**
* Utilidad
* Usabilidad
* Deseabilidad
* Encontrabilidad
* Valor
* Accesibilidad
* Credibilidad

## Análisis

### Utilidad

La aplicación permite ser usada de forma simple desde mediante dos pantallas. La página "Lunar Globe", abierta por defecto nada más entrar, permite acceder a una configuración específica de la segunda en un solo click. 

La página "Orbital Simulator" muestra las configuraciones posibles para empezar una simulación y modificarla de forma inmediata y con cambios en tiempo real.

En la página "Orbital Simulator" puede sentirse abrumadora para las usuarios que acaban de entrar en la página a causa del exceso de opciones que se muestran en pantalla a la vez. 

Se recomienda agrupar los botones en menús desplegables con nombres intuitivos que permitan a los usuarios sabes intuitivamente dónde están las opciones que quieren usar. Por ejemplo: los botones para seleccionar una misión distinta en la segunda pantalla (IM-1 Odysseus) podrían estar agrupados en un menú que se despliega con un botón llamado "Cambiar misión".


### Usabilidad

Los usuarios pueden completar todas las tareas dentro del alcance de la aplicación en pocos clicks. Se recomienda poner la vista avanzada cerca de los botones de selección de misión en la página "Orbital Simulator".

### Deseabilidad

La interfaz es simple pero transmite rigor técnico y científico en su disposición. Hay abuso del uso de tarjetas redondeadas, pueden llegar a contarse 4 tarjetas separadas que ocupan más del 50% del viewport en ciertos casos, con sus respectivas tarjetas interiores cada una. 

Se recomienda variar los patrones de diseño ligeramente según la profundidad de anidación de los componentes. 

También se recomienda fusionar algunas de las tarjetas en la página "Orbital Simulator". Por ejemplo la tarjeta desplegada por la "Vista Avanzada" puede estar anidado dentro del del resultado de la misión y desplegarse desde un lado extendiendo la tarjeta.

Como última recomendación se recomienda aplicar consistencia en las disposiciones entre las dos páginas. La página "Lunar Globe" tiene texto a la izquierda de los botones, con estos desplazados a la derecha en la barra superior, mientras que la página "Orbital Simulator" muestra el texto encima de los botones, que pasan a estar pegados al lazo izquierdo de la barra superior.

### Encontrabilidad

Los botones en la barra superior están desordenados y cambian de posición según la página en la que se encuentra el usuario.

Se recomienda agrupar visualmente los botones de la barra superior y fijar su posición entre las dos páginas, hablando en concreto de los botones esenciales "Lunar Globe" y "Orbital simulator".

### Valor

La página da acceso a una simulación completamente visual. Con poco esfuerzo y sin invertir a penas tiempo.

### Accesibilidad

La paleta de colores de las tarjetas tiene un contraste demasiado bajo. Junto con el reducido tamaño de letra hace que personas con defectos de visión fomo "Far-Sighted" o ciertos tipos de "Color-Blindness" no puedan leer textos de botones importantes.

Se recomineda modificar la paleta de colores para asegurar que todo el texto de botones e información importante, como el resultado de la simulación tenga el contraste adecuado. Esto puede verse reforzado por un ligero aumento del tamaño de fuente.

### Credibilidad

El diseño de la aplicación aporta una alta credibildiad debido a su profesionalismo y su muestra de simulaciones con rigor científico. Sin embargo, se recomienda añadir una página About us que permita a los usuarios saber sobre quienes están detrás del proyecto, su objetivo y un enlace al repositorio de github de desarrollo de la página, https://github.com/AndresFerCervell/One-Safe-Step-For-Mankind.