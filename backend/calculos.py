import json
import math
from typing import Dict, Any, List

class LandingSiteEvaluator:
    """
    Evaluador de viabilidad para sitios de alunizaje en el Polo Sur lunar.
    Integra topografía local (LOLA) y series temporales de efemérides (JPL Horizons).
    Incluye detección geométrica de eclipses terrestres.
    """

    def __init__(
        self,
        max_pendiente_deg: float = 15.0,
        min_delta_sol_t0_deg: float = 0.5,
        min_delta_tierra_t0_deg: float = 0.0,
        min_angulo_solar_deg: float = 5.0,
        min_horas_supervivencia: int = 120
    ):
        # Umbrales configurables según especificaciones del módulo lunar
        self.max_pendiente_deg = max_pendiente_deg
        self.min_delta_sol_t0_deg = min_delta_sol_t0_deg
        self.min_delta_tierra_t0_deg = min_delta_tierra_t0_deg
        self.min_angulo_solar_deg = min_angulo_solar_deg
        self.min_horas_supervivencia = min_horas_supervivencia

    @staticmethod
    def obtener_elevacion_horizonte(horizonte_360: List[float], azimut_deg: float) -> tuple[int, float]:
        """
        Redondea el azimut decimal al entero más cercano y aplica módulo 360
        para evitar errores de desbordamiento (ej. 359.8° -> índice 0).
        """
        if len(horizonte_360) != 360:
            raise ValueError(f"El perfil del horizonte debe tener exactamente 360 valores (tiene {len(horizonte_360)}).")
        
        indice_azimut = int(round(azimut_deg)) % 360
        return indice_azimut, float(horizonte_360[indice_azimut])

    @staticmethod
    def calcular_separacion_angular(az1_deg: float, el1_deg: float, az2_deg: float, el2_deg: float) -> float:
        """
        Calcula la distancia angular real entre dos cuerpos celestes en el cielo
        usando la ley de los cosenos esféricos.
        """
        az1, el1 = math.radians(az1_deg), math.radians(el1_deg)
        az2, el2 = math.radians(az2_deg), math.radians(el2_deg)
        
        # Ley de los cosenos esféricos
        cos_d = (math.sin(el1) * math.sin(el2)) + (math.cos(el1) * math.cos(el2) * math.cos(az1 - az2))
        
        # Limitar entre -1 y 1 para evitar errores de precisión de coma flotante con math.acos
        cos_d = max(-1.0, min(1.0, cos_d))
        
        return math.degrees(math.acos(cos_d))

    def evaluar_sitio(self, clave_sitio: str, datos_sitio: Dict[str, Any], ephemeris: Dict[str, Any]) -> Dict[str, Any]:
        """
        Ejecuta la secuencia de evaluación paso a paso. Si un paso crítico falla,
        interrumpe la evaluación y devuelve el diagnóstico técnico detallado.
        """
        nombre = datos_sitio.get("nombre", clave_sitio)
        lat = datos_sitio.get("lat")
        lon = datos_sitio.get("lon")
        pendiente = float(datos_sitio.get("pendiente_deg", 0.0))
        horizonte_360 = datos_sitio.get("horizonte_360", [])
        timeline = ephemeris.get("timeline", [])
        t0_str = ephemeris.get("t0_aterrizaje", "Desconocido")

        if not timeline:
            raise ValueError("La serie temporal 'timeline' de efemérides está vacía.")

        # Estructura base del reporte de salida
        reporteBase = {
            "sitio_id": clave_sitio,
            "nombre": nombre,
            "coordenadas": {"lat": lat, "lon": lon},
            "t0_aterrizaje": t0_str
        }

        # =====================================================================
        # PASO 1: Topografía y Terreno (Pendiente local)
        # =====================================================================
        if pendiente >= self.max_pendiente_deg:
            return {
                **reporteBase,
                "viable": False,
                "paso_fallido": "1. Topografía y Terreno",
                "fallo": 1,
                "motivo_rechazo": "Fallo mecánico: El módulo vuelca por exceso de inclinación.",
                "mensaje_tecnico": (
                    f"Fallo mecánico: Pendiente de {pendiente:.2f}° excede el límite "
                    f"estructural de las patas ({self.max_pendiente_deg:.1f}°)."
                ),
                "datos_tecnicos": {
                    "pendiente_evaluada_deg": round(pendiente, 2),
                    "umbral_maximo_deg": self.max_pendiente_deg
                }
            }

        # Datos celestes en el instante del descenso (t0 -> índice 0)
        estado_t0 = timeline[0]
        sol_el_t0 = float(estado_t0["sol_elevacion_deg"])
        sol_az_t0 = float(estado_t0["sol_azimut_deg"])
        tierra_el_t0 = float(estado_t0["tierra_elevacion_deg"])
        tierra_az_t0 = float(estado_t0["tierra_azimut_deg"])

        # =====================================================================
        # PASO 2 y 3: Perfil del Horizonte e Iluminación Inicial en Descenso (t0)
        # =====================================================================
        az_sol_idx, horiz_sol_t0 = self.obtener_elevacion_horizonte(horizonte_360, sol_az_t0)
        delta_el_sol_t0 = sol_el_t0 - horiz_sol_t0

        if delta_el_sol_t0 <= self.min_delta_sol_t0_deg:
            return {
                **reporteBase,
                "viable": False,
                "paso_fallido": "3. Iluminación Inicial en Descenso",
                "fallo": 3,
                "motivo_rechazo": "Fallo de navegación: Módulo aterriza a oscuras.",
                "mensaje_tecnico": (
                    f"Fallo de navegación: Sol a {delta_el_sol_t0:+.2f}° respecto al relieve en azimut {az_sol_idx}° "
                    f"(Sol: {sol_el_t0:.2f}°, Horizonte: {horiz_sol_t0:.2f}°); sensores ópticos sin visibilidad."
                ),
                "datos_tecnicos": {
                    "delta_elevacion_sol_deg": round(delta_el_sol_t0, 3),
                    "umbral_minimo_deg": self.min_delta_sol_t0_deg,
                    "sol_elevacion_deg": round(sol_el_t0, 3),
                    "sol_azimut_deg": round(sol_az_t0, 3),
                    "azimut_horizonte_indexado": az_sol_idx,
                    "horizonte_bloqueo_deg": round(horiz_sol_t0, 3)
                }
            }

        # =====================================================================
        # PASO 4: Enlace de Radio Directo a la Tierra (LOS en t0)
        # =====================================================================
        az_tierra_idx, horiz_tierra_t0 = self.obtener_elevacion_horizonte(horizonte_360, tierra_az_t0)
        delta_el_tierra_t0 = tierra_el_t0 - horiz_tierra_t0

        if delta_el_tierra_t0 <= self.min_delta_tierra_t0_deg:
            return {
                **reporteBase,
                "viable": False,
                "paso_fallido": "4. Enlace de Radio (t0)",
                "fallo": 4,
                "motivo_rechazo": "Pérdida de señal (LOS) justo antes de tocar el suelo.",
                "mensaje_tecnico": (
                    f"Pérdida de telemetría (LOS): La Tierra está bloqueada ({delta_el_tierra_t0:+.2f}°) "
                    f"por el relieve en azimut {az_tierra_idx}° (Tierra: {tierra_el_t0:.2f}°, Horizonte: {horiz_tierra_t0:.2f}°)."
                ),
                "datos_tecnicos": {
                    "delta_elevacion_tierra_deg": round(delta_el_tierra_t0, 3),
                    "umbral_minimo_deg": self.min_delta_tierra_t0_deg,
                    "tierra_elevacion_deg": round(tierra_el_t0, 3),
                    "tierra_azimut_deg": round(tierra_az_t0, 3),
                    "azimut_horizonte_indexado": az_tierra_idx,
                    "horizonte_bloqueo_deg": round(horiz_tierra_t0, 3)
                }
            }

        # =====================================================================
        # PASO 5: Ángulo de Elevación Solar (Eficiencia energética en t0)
        # =====================================================================
        if sol_el_t0 <= self.min_angulo_solar_deg:
            return {
                **reporteBase,
                "viable": False,
                "paso_fallido": "5. Ángulo de Eficiencia Solar",
                "fallo": 5,
                "motivo_rechazo": "Rendimiento energético subóptimo; riesgo térmico.",
                "mensaje_tecnico": (
                    f"Rendimiento energético subóptimo en el aterrizaje: Elevación solar absoluta de {sol_el_t0:.2f}° "
                    f"es inferior al umbral operativo de los paneles ({self.min_angulo_solar_deg:.1f}°)."
                ),
                "datos_tecnicos": {
                    "sol_elevacion_absoluta_deg": round(sol_el_t0, 3),
                    "umbral_eficiencia_solar_deg": self.min_angulo_solar_deg,
                    "delta_elevacion_sol_deg": round(delta_el_sol_t0, 3)
                }
            }

        # =====================================================================
        # PASO 6: Ventanas Operativas y Supervivencia (Serie temporal)
        # =====================================================================
        horas_totales_luz = 0
        horas_totales_comunicacion = 0
        horas_hasta_sunset = None
        horas_hasta_earthset = None
        horas_en_eclipse = 0 # Contador de horas perdidas por eclipse

        for punto in timeline:
            hora_actual = int(punto["hora_offset"])
            s_el = float(punto["sol_elevacion_deg"])
            s_az = float(punto["sol_azimut_deg"])
            t_el = float(punto["tierra_elevacion_deg"])
            t_az = float(punto["tierra_azimut_deg"])

            _, h_sol = self.obtener_elevacion_horizonte(horizonte_360, s_az)
            _, h_tierra = self.obtener_elevacion_horizonte(horizonte_360, t_az)

            # Comprobación geométrica de Eclipse
            separacion_tierra_sol = self.calcular_separacion_angular(s_az, s_el, t_az, t_el)
            eclipse_activo = separacion_tierra_sol < 1.2

            # Lógica de Luz: Sol sobre horizonte Y no tapado por la Tierra
            hay_luz = (s_el - h_sol) > 0.0

            if hay_luz and eclipse_activo:
                hay_luz = False
                horas_en_eclipse += 1

            # Lógica de Radio
            hay_radio = (t_el - h_tierra) > 0.0

            if hay_luz:
                horas_totales_luz += 1
            elif horas_hasta_sunset is None:
                horas_hasta_sunset = hora_actual

            if hay_radio:
                horas_totales_comunicacion += 1
            elif horas_hasta_earthset is None:
                horas_hasta_earthset = hora_actual

        total_horas_simuladas = len(timeline)
        if horas_hasta_sunset is None:
            horas_hasta_sunset = total_horas_simuladas
        if horas_hasta_earthset is None:
            horas_hasta_earthset = total_horas_simuladas

        if horas_totales_luz <= self.min_horas_supervivencia:
            return {
                **reporteBase,
                "viable": False,
                "paso_fallido": "6. Ventanas Operativas (Supervivencia)",
                "fallo": 6,
                "motivo_rechazo": "Fallo térmico/energético: Baterías agotadas por frío prematuro.",
                "mensaje_tecnico": (
                    f"Fallo térmico/energético: Solo {horas_totales_luz}h de luz previstas en las próximas "
                    f"{total_horas_simuladas}h (mínimo requerido: >{self.min_horas_supervivencia}h); baterías agotadas."
                ),
                "datos_tecnicos": {
                    "horas_totales_luz": horas_totales_luz,
                    "horas_perdidas_por_eclipse": horas_en_eclipse,
                    "umbral_minimo_horas_luz": self.min_horas_supervivencia,
                    "horas_simuladas": total_horas_simuladas,
                    "horas_continuas_hasta_primer_sunset": horas_hasta_sunset,
                    "horas_totales_comunicacion": horas_totales_comunicacion
                }
            }

        # =====================================================================
        # ÉXITO: El sitio supera todas las validaciones
        # =====================================================================
        return {
            **reporteBase,
            "viable": True,
            "paso_fallido": None,
            "fallo": -1,
            "motivo_rechazo": None,
            "mensaje_tecnico": (
                f"Sitio viable. Aterrizaje seguro (pendiente {pendiente:.1f}°) con {horas_totales_luz}h de luz "
                f"y {horas_totales_comunicacion}h de enlace terrestre en los próximos {total_horas_simuladas // 24} días."
            ),
            "datos_tecnicos": {
                "pendiente_evaluada_deg": round(pendiente, 2),
                "delta_luz_t0_deg": round(delta_el_sol_t0, 3),
                "delta_tierra_t0_deg": round(delta_el_tierra_t0, 3),
                "sol_elevacion_t0_deg": round(sol_el_t0, 3),
                "horas_totales_luz": horas_totales_luz,
                "horas_perdidas_por_eclipse": horas_en_eclipse,
                "horas_totales_comunicacion": horas_totales_comunicacion,
                "horas_continuas_hasta_primer_sunset": horas_hasta_sunset,
                "horas_continuas_hasta_primer_earthset": horas_hasta_earthset,
                "horas_simuladas": total_horas_simuladas
            }
        }

    def evaluar_dataset_completo(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Procesa todos los sitios contenidos en el JSON de entrada frente al timeline de efemérides."""
        sitios = payload.get("sitios", {})
        ephemeris = payload.get("ephemeris", {})
        resultados = {}

        for clave_sitio, datos_sitio in sitios.items():
            resultados[clave_sitio] = self.evaluar_sitio(clave_sitio, datos_sitio, ephemeris)

        return resultados


# =============================================================================
# BLOQUE DE PRUEBA CON DATOS REALES (SHACKLETON) Y CASOS DE RECHAZO
# =============================================================================
if __name__ == "__main__":
    horizonte_shackleton = [
        21.017, 20.935, 20.916, 20.691, 20.658, 20.657, 20.629, 20.595, 20.432, 20.502,
        20.528, 20.344, 20.41, 20.407, 20.306, 20.31, 20.223, 20.123, 20.221, 20.14,
        20.132, 20.292, 20.263, 20.281, 20.26, 20.273, 20.321, 20.345, 20.419, 20.389,
        20.478, 20.511, 20.499, 20.561, 20.571, 20.577, 20.581, 20.565, 20.568, 20.5,
        20.541, 20.522, 20.533, 20.488, 20.461, 20.484, 20.503, 20.483, 20.484, 20.454,
        20.539, 20.537, 20.523, 20.452, 20.487, 20.525, 20.644, 20.672, 20.703, 20.675,
        20.674, 20.695, 20.707, 20.717, 20.733, 20.791, 20.831, 20.892, 20.993, 21.024,
        21.064, 21.144, 21.172, 21.291, 21.369, 21.384, 21.441, 21.397, 21.536, 21.427,
        21.443, 21.51, 21.482, 21.477, 21.652, 21.687, 21.625, 21.583, 21.615, 21.588,
        21.596, 21.565, 21.553, 21.561, 21.545, 21.577, 21.64, 21.521, 21.572, 21.622,
        21.514, 21.499, 21.532, 21.401, 21.446, 21.316, 21.437, 21.421, 21.294, 21.325,
        21.276, 21.28, 21.219, 21.189, 21.203, 21.179, 21.157, 21.068, 21.022, 20.954,
        20.906, 20.908, 20.897, 20.906, 20.847, 20.881, 20.845, 20.781, 20.79, 20.833,
        20.848, 20.822, 20.837, 20.89, 20.92, 20.934, 20.924, 20.883, 20.851, 20.889,
        20.873, 20.91, 20.881, 20.895, 20.863, 20.881, 20.83, 20.844, 20.828, 20.826,
        20.816, 20.858, 20.85, 20.839, 20.833, 20.844, 20.869, 20.844, 20.831, 20.823,
        20.886, 20.847, 20.701, 20.711, 20.689, 20.588, 20.657, 20.567, 20.615, 20.551,
        20.638, 20.62, 20.559, 20.52, 20.656, 20.624, 20.618, 20.552, 20.619, 20.622,
        20.665, 20.663, 20.7, 20.686, 20.715, 20.758, 20.826, 20.76, 20.829, 20.899,
        21.005, 20.899, 21.018, 20.98, 21.068, 21.067, 21.181, 21.123, 21.088, 21.199,
        21.177, 21.201, 21.25, 21.352, 21.321, 21.32, 21.355, 21.356, 21.323, 21.347,
        21.378, 21.374, 21.372, 21.414, 21.34, 21.421, 21.455, 21.545, 21.498, 21.545,
        21.561, 21.5, 21.511, 21.588, 21.537, 21.553, 21.558, 21.655, 21.68, 21.727,
        21.761, 21.807, 21.817, 21.864, 21.8, 21.787, 21.766, 21.773, 21.814, 21.863,
        21.79, 21.912, 21.895, 21.875, 21.847, 21.821, 21.779, 21.705, 21.692, 21.683,
        21.717, 21.736, 21.59, 21.611, 21.7, 21.611, 21.674, 21.7, 21.82, 21.754,
        21.863, 21.783, 21.744, 21.857, 21.83, 21.837, 21.847, 22.052, 22.116, 22.148,
        22.24, 22.29, 22.329, 22.409, 22.254, 22.28, 22.322, 22.352, 22.211, 22.239,
        22.303, 22.175, 22.193, 22.091, 22.161, 22.039, 22.059, 21.955, 21.886, 21.938,
        21.872, 21.792, 21.743, 21.746, 21.689, 21.704, 21.69, 21.674, 21.561, 21.537,
        21.542, 21.558, 21.461, 21.438, 21.35, 21.313, 21.316, 21.284, 21.235, 21.234,
        21.169, 21.16, 21.096, 21.066, 21.051, 21.032, 21.03, 21.03, 21.097, 21.007,
        21.008, 21.047, 20.971, 20.964, 21.021, 21.06, 21.121, 21.115, 21.119, 21.191,
        21.301, 21.344, 21.335, 21.345, 21.377, 21.414, 21.421, 21.387, 21.429, 21.431,
        21.534, 21.65, 21.539, 21.565, 21.609, 21.454, 21.471, 21.354, 21.359, 21.23,
        21.272, 21.25, 21.216, 21.241, 21.171, 21.118, 21.067, 20.97, 21.066, 21.046
    ]

    # Generamos serie temporal de 336 horas
    timeline_336h = []
    for h in range(336):
        timeline_336h.append({
            "hora_offset": h,
            "sol_elevacion_deg": 10.6988,
            "sol_azimut_deg": (8.8067 + h * 0.5) % 360,
            "tierra_elevacion_deg": 59.2242,
            "tierra_azimut_deg": 72.1953
        })

    datos_entrada = {
        "sitios": {
            "shackleton_rim": {
                "nombre": "Borde Cráter Shackleton (Polo Sur)",
                "lat": -89.65,
                "lon": 129.2,
                "elevacion_m": -2762.94,
                "pendiente_deg": 5.1,
                "horizonte_360": horizonte_shackleton
            },
            "ladera_escarpada": {
                "nombre": "Pared Interior Shackleton",
                "lat": -89.70,
                "lon": 130.0,
                "elevacion_m": -3100.0,
                "pendiente_deg": 22.0,
                "horizonte_360": [5.0] * 360
            },
            "apollo_11": {
                "nombre": "Tranquility Base (Apolo 11 - Comparación)",
                "lat": 0.674,
                "lon": 23.473,
                "elevacion_m": -1850.0,
                "pendiente_deg": 1.8,
                "horizonte_360": [0.1] * 360
            }
        },
        "ephemeris": {
            "t0_aterrizaje": "2026-11-14T12:00:00Z",
            "timeline": timeline_336h
        }
    }

    # Instanciar evaluador (umbral de eficiencia solar configurado a 5.0°)
    evaluador = LandingSiteEvaluator(min_angulo_solar_deg=5.0)
    resultados = evaluador.evaluar_dataset_completo(datos_entrada)

    print(json.dumps(resultados, indent=2, ensure_ascii=False))