"""Estimación de viabilidad por criterios geométricos, sin modelo de vehículo.

El informe v2 acumula todos los fallos evaluables. Un dato ausente no equivale
a un criterio superado: se registra y se devuelve la evaluación incompleta.
La pendiente se evalúa con P95; para JSON antiguos sin ese campo se usa el
máximo anterior y se declara la métrica utilizada en datos_tecnicos.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path


# 2 y 7 describen datos, no un rechazo físico. Se conservan los códigos previos.
DICCIONARIO_FALLOS = {
    1: "Pendiente del terreno igual o superior al máximo permitido para aterrizar.",
    2: "Datos obligatorios ausentes, inválidos o incompatibles con el sitio.",
    3: "Obstrucción inicial por relieve o eclipse del Sol situado sobre el horizonte horizontal.",
    4: "Visibilidad directa de la Tierra insuficiente en el aterrizaje.",
    5: "Elevación solar inicial igual o inferior al mínimo configurado.",
    6: "Horas de luz estimadas iguales o inferiores al requisito configurado.",
    7: "Cobertura temporal insuficiente para evaluar el requisito de iluminación.",
}
CRITERIOS = (1, 3, 4, 5, 6)
MODELO_ECLIPSE = "segmento_sol_puntual_tierra_esferica"


def _json_seguro(valor):
    """Los datos de procedencia inválidos tampoco deben producir NaN en JSON."""
    if isinstance(valor, float) and not math.isfinite(valor):
        return None
    if isinstance(valor, dict):
        return {k: _json_seguro(v) for k, v in valor.items()}
    if isinstance(valor, list):
        return [_json_seguro(v) for v in valor]
    return valor


def _numero(valor: object, nombre: str, minimo=-math.inf, maximo=math.inf) -> float:
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        raise ValueError(f"{nombre}: se requiere un número finito.")
    try:
        numero = float(valor)
    except OverflowError as error:
        raise ValueError(f"{nombre}: número fuera de rango.") from error
    if not math.isfinite(numero) or not minimo <= numero <= maximo:
        raise ValueError(f"{nombre}: número no finito o fuera de [{minimo}, {maximo}].")
    return numero


class LandingSiteEvaluator:
    def __init__(
        self, max_pendiente_deg: float = 15.0,
        min_delta_sol_t0_deg: float = 0.5,
        min_delta_tierra_t0_deg: float = 0.0,
        min_angulo_solar_deg: float = 5.0,
        min_horas_supervivencia: float | None = None,
        *, min_porcentaje_luz: float = 50.0,
    ):
        self.max_pendiente_deg = _numero(max_pendiente_deg, "max_pendiente_deg", 0, 90)
        self.min_delta_sol_t0_deg = _numero(min_delta_sol_t0_deg, "min_delta_sol_t0_deg", 0, 180)
        self.min_delta_tierra_t0_deg = _numero(min_delta_tierra_t0_deg, "min_delta_tierra_t0_deg", 0, 180)
        self.min_angulo_solar_deg = _numero(min_angulo_solar_deg, "min_angulo_solar_deg", -90, 90)
        self.min_porcentaje_luz = _numero(min_porcentaje_luz, "min_porcentaje_luz", 0, 100)
        # Compatibilidad con llamadas que configuran explícitamente horas absolutas.
        self.min_horas_supervivencia = (
            None if min_horas_supervivencia is None else
            _numero(min_horas_supervivencia, "min_horas_supervivencia", 0))

    @staticmethod
    def obtener_elevacion_horizonte(horizonte_360: list[float], azimut_deg: float) -> tuple[int, float]:
        """Acimut redondeado al grado más próximo, periódico en 360 grados."""
        if len(horizonte_360) != 360:
            raise ValueError("El horizonte debe contener exactamente 360 valores.")
        indice = int(round(_numero(azimut_deg, "azimut_deg"))) % 360
        return indice, _numero(horizonte_360[indice], f"horizonte_360[{indice}]", -90, 90)

    def _margen(self, horizonte: list[float], elevacion: float, azimut: float | None) -> float:
        if azimut is None:
            # En cénit/nadir el acimut es irrelevante. Usamos el horizonte
            # más restrictivo sin inventar una dirección norte.
            return elevacion - (max(horizonte) if elevacion > 0 else min(horizonte))
        return elevacion - self.obtener_elevacion_horizonte(horizonte, azimut)[1]

    def evaluar_sitio(self, clave_sitio: str, datos_sitio: dict, ephemeris: dict) -> dict:
        errores = []
        fallos = []
        evaluados = set()
        metricas = {}

        def leer(valor, campo, minimo=-math.inf, maximo=math.inf):
            try:
                return _numero(valor, campo, minimo, maximo)
            except ValueError as error:
                errores.append(str(error))
                return None

        def fallo(codigo, mensaje, datos=None):
            fallos.append({"codigo": codigo, "descripcion": DICCIONARIO_FALLOS[codigo],
                           "mensaje_tecnico": mensaje, "datos_tecnicos": datos or {}})

        if not isinstance(datos_sitio, dict):
            errores.append("El sitio debe ser un objeto.")
            datos_sitio = {}
        if not isinstance(ephemeris, dict):
            errores.append("ephemeris debe ser un objeto propio de este sitio.")
            ephemeris = {}
        lat = leer(datos_sitio.get("lat"), "lat", -90, 90)
        lon = leer(datos_sitio.get("lon"), "lon", -180, 360)
        altura = leer(datos_sitio.get("elevacion_m"), "elevacion_m")
        # Los JSON anteriores solo contienen el máximo. Su uso se declara
        # explícitamente; un P95 presente pero inválido nunca activa ese fallback.
        campo_pendiente = "pendiente_p95_deg" if "pendiente_p95_deg" in datos_sitio else "pendiente_deg"
        pendiente = leer(datos_sitio.get(campo_pendiente), campo_pendiente, 0, 90)
        metricas["criterio_pendiente"] = campo_pendiente
        if pendiente is not None:
            evaluados.add(1)
            metricas["pendiente_evaluada_deg"] = pendiente
            if pendiente >= self.max_pendiente_deg:
                fallo(1, f"{campo_pendiente} = {pendiente:g}°; se exige < {self.max_pendiente_deg:g}°.")

        horizonte = datos_sitio.get("horizonte_360")
        if not isinstance(horizonte, list) or len(horizonte) != 360:
            errores.append("horizonte_360 debe ser una lista de 360 ángulos en grados.")
            horizonte = None
        else:
            horizonte = [leer(h, f"horizonte_360[{i}]", -90, 90) for i, h in enumerate(horizonte)]
            if any(h is None for h in horizonte):
                horizonte = None

        t0 = None
        try:
            fecha = datetime.fromisoformat(ephemeris.get("t0_aterrizaje", "").replace("Z", "+00:00"))
            if fecha.tzinfo is None or fecha.utcoffset() is None:
                raise ValueError("Falta zona horaria")
            t0 = fecha.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        except (ValueError, TypeError, AttributeError, OverflowError):
            errores.append("t0_aterrizaje debe ser una fecha ISO 8601 con zona horaria.")

        # Los ángulos locales solo son aplicables al observador que los generó.
        lugar = ephemeris.get("lugar")
        if not isinstance(lugar, dict):
            lugar = {}
        lat_e = leer(lugar.get("latitud_deg"), "ephemeris.lugar.latitud_deg", -90, 90)
        lon_e = leer(lugar.get("longitud_deg"), "ephemeris.lugar.longitud_deg", -180, 360)
        altura_e = leer(lugar.get("altura_m"), "ephemeris.lugar.altura_m")
        origen_valido = all(v is not None for v in (lat, lon, altura, lat_e, lon_e, altura_e))
        if origen_valido:
            origen_valido = (math.isclose(lat, lat_e, abs_tol=1e-8, rel_tol=0)
                             and abs((lon - lon_e + 180) % 360 - 180) <= 1e-8
                             and math.isclose(altura, altura_e, abs_tol=1e-3, rel_tol=0))
            if not origen_valido:
                errores.append("Las coordenadas/altura de ephemeris.lugar no coinciden con el sitio.")
        unidades = ephemeris.get("unidades")
        unidades_validas = isinstance(unidades, dict) and all(
            unidades.get(k) == v for k, v in {"angulos": "deg", "tiempo": "h", "altura": "m"}.items())
        if not unidades_validas:
            errores.append("ephemeris.unidades debe declarar angulos=deg, tiempo=h y altura=m.")
        modelo = ephemeris.get("modelo")
        modelo_valido = isinstance(modelo, dict) and modelo.get("eclipse") == MODELO_ECLIPSE
        if not modelo_valido:
            errores.append(f"ephemeris.modelo.eclipse debe ser {MODELO_ECLIPSE}.")
        fuente = ephemeris.get("fuente")
        if not isinstance(fuente, str) or not fuente.strip():
            errores.append("ephemeris.fuente es obligatoria.")

        duracion = leer(ephemeris.get("duracion_solicitada_horas"), "duracion_solicitada_horas", 0)
        requisito_luz_horas = self.min_horas_supervivencia
        if requisito_luz_horas is None and duracion is not None:
            requisito_luz_horas = duracion * (self.min_porcentaje_luz / 100)
        metricas["requisito_exclusivo_luz_horas"] = requisito_luz_horas
        timeline = ephemeris.get("timeline")
        if not isinstance(timeline, list) or not timeline:
            errores.append("timeline debe ser una lista no vacía de muestras.")
            timeline = []
        filas = []
        for i, punto in enumerate(timeline):
            if not isinstance(punto, dict):
                errores.append(f"timeline[{i}] debe ser un objeto.")
                punto = {}
            fila = {"hora_offset": leer(punto.get("hora_offset"), f"timeline[{i}].hora_offset", 0)}
            for cuerpo in ("sol", "tierra"):
                el = leer(punto.get(f"{cuerpo}_elevacion_deg"), f"timeline[{i}].{cuerpo}_elevacion_deg", -90, 90)
                az = punto.get(f"{cuerpo}_azimut_deg")
                vertical = el is not None and abs(el) == 90
                if az is None and not vertical:
                    errores.append(f"timeline[{i}].{cuerpo}_azimut_deg indefinido fuera de cénit/nadir.")
                elif az is not None:
                    az = leer(az, f"timeline[{i}].{cuerpo}_azimut_deg", 0, 360)
                fila[f"{cuerpo}_el"] = el
                fila[f"{cuerpo}_margen"] = (
                    self._margen(horizonte, el, az)
                    if horizonte is not None and el is not None and (az is not None or vertical) else None)
            eclipse = punto.get("tierra_bloquea_sol")
            if type(eclipse) is not bool:
                errores.append(f"timeline[{i}].tierra_bloquea_sol debe ser booleano.")
                eclipse = None
            fila["eclipse"] = eclipse if modelo_valido else None
            filas.append(fila)

        tiempos = [fila["hora_offset"] for fila in filas]
        tiempos_validos = bool(tiempos) and all(t is not None for t in tiempos)
        if tiempos_validos:
            tiempos_validos = tiempos[0] == 0 and all(b > a for a, b in zip(tiempos, tiempos[1:]))
            if not tiempos_validos:
                errores.append("timeline debe comenzar en cero y tener offsets estrictamente crecientes.")
        if tiempos_validos and duracion is not None and tiempos[-1] > duracion + 1e-9:
            errores.append("timeline sobrepasa la duración solicitada.")
            tiempos_validos = False
        if "paso_horas" in ephemeris:
            paso = leer(ephemeris["paso_horas"], "paso_horas", 0)
            if paso == 0:
                errores.append("paso_horas debe ser positivo.")
            if paso is None or paso == 0:
                tiempos_validos = False
            elif tiempos_validos and any(not math.isclose(b - a, paso, abs_tol=1e-9, rel_tol=0)
                                        for a, b in zip(tiempos, tiempos[1:])):
                errores.append("Faltan muestras o los offsets no coinciden con paso_horas.")
                tiempos_validos = False

        geometria_valida = origen_valido and unidades_validas
        inicial = filas[0] if filas and filas[0]["hora_offset"] == 0 and t0 is not None and geometria_valida else None
        if inicial is not None:
            sol, tierra = inicial["sol_margen"], inicial["tierra_margen"]
            metricas.update(delta_luz_t0_deg=sol, delta_tierra_t0_deg=tierra,
                            sol_elevacion_t0_deg=inicial["sol_el"], eclipse_t0=inicial["eclipse"])
            elevacion_sol = inicial["sol_el"]
            sobre_horizontal = elevacion_sol is not None and elevacion_sol > 0
            # Un horizonte positivo aporta una obstrucción adicional al horizonte
            # horizontal. La elevación baja por sí sola corresponde al código 5.
            relieve = (sobre_horizontal and sol is not None and sol < elevacion_sol
                       and sol <= self.min_delta_sol_t0_deg)
            eclipse = sobre_horizontal and inicial["eclipse"] is True
            sin_sol_sobre_horizontal = elevacion_sol is not None and elevacion_sol <= 0
            fallo_luz_inicial = relieve or eclipse
            if (fallo_luz_inicial or sin_sol_sobre_horizontal
                    or (sol is not None and inicial["eclipse"] is not None)):
                evaluados.add(3)
                if fallo_luz_inicial:
                    causas = [causa for causa, ocurre in (("relieve", relieve), ("eclipse", eclipse)) if ocurre]
                    fallo(3, "Obstrucción inicial del Sol sobre el horizonte horizontal por " + " y ".join(causas) + ".",
                          {"delta_elevacion_sol_deg": sol, "sol_elevacion_deg": elevacion_sol,
                           "eclipse": inicial["eclipse"], "causas": causas})
            if tierra is not None:
                evaluados.add(4)
                if tierra <= self.min_delta_tierra_t0_deg:
                    fallo(4, f"Margen terrestre {tierra:g}°; se exige > {self.min_delta_tierra_t0_deg:g}°.")
            if inicial["sol_el"] is not None:
                evaluados.add(5)
                if inicial["sol_el"] <= self.min_angulo_solar_deg:
                    fallo(5, f"Elevación solar {inicial['sol_el']:g}°; se exige > {self.min_angulo_solar_deg:g}°.")

        cobertura = {"horas_solicitadas": duracion, "horas_observadas": tiempos[-1] if tiempos_validos else None,
                     "completa": False, "suficiente_para_requisito_luz": False}
        if tiempos_validos and duracion is not None:
            cobertura["completa"] = math.isclose(tiempos[-1], duracion, abs_tol=1e-9, rel_tol=0)
            cobertura["suficiente_para_requisito_luz"] = cobertura["completa"] and duracion > 0
            if not cobertura["suficiente_para_requisito_luz"]:
                fallo(7, "La serie no cubre toda la duración solicitada o esta no contiene un intervalo de tiempo positivo.",
                      {"horas_observadas": tiempos[-1], "horas_solicitadas": duracion,
                       "requisito_exclusivo_horas": requisito_luz_horas})

        if tiempos_validos and geometria_valida and t0 is not None:
            intervalos = [b - a for a, b in zip(tiempos, tiempos[1:])]

            def integrar(estados):
                return math.fsum(dt for dt, estado in zip(intervalos, estados) if estado)

            def primera_perdida(estados):
                for i, estado in enumerate(estados):
                    if not estado:
                        return {"hora_detectada": tiempos[i],
                                "intervalo_horas": [tiempos[max(0, i - 1)], tiempos[i]]}
                return None

            metricas.update(horas_simuladas=tiempos[-1], paso_maximo_horas=max(intervalos, default=0))
            if all(f["sol_margen"] is not None and f["eclipse"] is not None for f in filas):
                luz = [f["sol_margen"] > 0 and not f["eclipse"] for f in filas]
                eclipses = [f["sol_margen"] > 0 and f["eclipse"] for f in filas]
                luz_sin_relieve = [f["sol_el"] > 0 and not f["eclipse"] for f in filas]
                sombra_relieve = [f["sol_el"] > 0 and f["sol_margen"] <= 0 and not f["eclipse"] for f in filas]
                metricas.update(horas_totales_luz=integrar(luz), horas_perdidas_por_eclipse=integrar(eclipses),
                                horas_luz_sin_relieve=integrar(luz_sin_relieve),
                                horas_perdidas_por_relieve=integrar(sombra_relieve),
                                porcentaje_luz=integrar(luz) / duracion * 100 if duracion else None,
                                primera_perdida_luz=primera_perdida(luz))
                if cobertura["suficiente_para_requisito_luz"]:
                    evaluados.add(6)
                    if metricas["horas_totales_luz"] <= requisito_luz_horas:
                        fallo(6, f"Luz estimada {metricas['horas_totales_luz']:g} h; se exige > {requisito_luz_horas:g} h.",
                              {"horas_solicitadas": duracion, "requisito_exclusivo_horas": requisito_luz_horas,
                               "porcentaje_luz": metricas["porcentaje_luz"]})
            if all(f["tierra_margen"] is not None for f in filas):
                radio = [f["tierra_margen"] > 0 for f in filas]
                metricas.update(horas_totales_comunicacion=integrar(radio), primera_perdida_comunicacion=primera_perdida(radio))

        if errores:
            fallo(2, "No se pueden evaluar todos los criterios con los datos recibidos.", {"errores": errores})
        fallos.sort(key=lambda f: f["codigo"])
        codigos = [f["codigo"] for f in fallos]
        rechazos = any(c in CRITERIOS for c in codigos)
        completa = not errores and cobertura["suficiente_para_requisito_luz"] and set(CRITERIOS) == evaluados
        viable = False if rechazos else True if completa else None
        estado = "no_viable" if rechazos else "viable" if completa else "datos_insuficientes"
        return _json_seguro({
            "version_contrato": 2, "sitio_id": clave_sitio, "nombre": datos_sitio.get("nombre", clave_sitio),
            "coordenadas": {"lat": lat, "lon": lon}, "t0_aterrizaje": t0,
            "viable": viable, "estado": estado, "evaluacion_completa": completa,
            "fallos": codigos, "detalle_fallos": fallos, "diccionario_fallos": DICCIONARIO_FALLOS.copy(),
            "criterios_no_evaluados": sorted(set(CRITERIOS) - evaluados),
            "mensaje_tecnico": {
                "viable": "El sitio supera los criterios configurados de viabilidad estimada.",
                "no_viable": "El sitio incumple uno o varios criterios configurados.",
                "datos_insuficientes": "No hay datos suficientes para decidir la viabilidad.",
            }[estado],
            "parametros_mision": vars(self).copy(), "cobertura_temporal": cobertura,
            "datos_tecnicos": metricas,
            "modelo": {"alcance": "estimacion geometrica; sin simulacion de descenso ni balance termico/energetico",
                       "eclipse": MODELO_ECLIPSE,
                       "integracion": "estado de la muestra izquierda en [t_i, t_i+1); ultimo extremo sin duracion",
                       "eventos": "primera muestra de perdida y su intervalo; null si no se observa",
                       "horizonte": "acimut al grado mas proximo; no resuelve obstaculos subpixel",
                       "comunicacion": "visibilidad del centro terrestre; no garantiza enlace con una estacion"},
            "metadatos_terreno": datos_sitio.get("metadatos", {}),
            "procedencia_efemerides": {k: ephemeris.get(k) for k in ("fuente", "lugar", "unidades", "modelo", "decimales_angulos")},
        })

    def evaluar_dataset_completo(self, payload: dict) -> dict:
        """Una serie propia por sitio; la forma antigua solo admite un sitio."""
        if not isinstance(payload, dict) or not isinstance(payload.get("sitios"), dict) or not payload["sitios"]:
            raise ValueError("El payload debe contener un diccionario 'sitios' no vacío.")
        sitios = payload["sitios"]
        por_sitio = payload.get("ephemeris_por_sitio")
        if por_sitio is not None and not isinstance(por_sitio, dict):
            raise ValueError("ephemeris_por_sitio debe ser un diccionario indexado por sitio.")
        return {clave: self.evaluar_sitio(
            clave, sitio, por_sitio.get(clave) if por_sitio is not None else
            payload.get("ephemeris") if len(sitios) == 1 else None,
        ) for clave, sitio in sitios.items()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("entrada", type=Path, help="JSON combinado con sitios y efemérides propias de cada sitio")
    parser.add_argument("--min-porcentaje-luz", type=float, default=50.0,
                        help="Porcentaje de las horas solicitadas que debe superarse con luz (0 a 100)")
    args = parser.parse_args()
    resultado = LandingSiteEvaluator(min_porcentaje_luz=args.min_porcentaje_luz).evaluar_dataset_completo(
        json.loads(args.entrada.read_text(encoding="utf-8")))
    print(json.dumps(resultado, indent=2, ensure_ascii=False, allow_nan=False))
