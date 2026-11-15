"""Regresiones del evaluador y del flujo local. Todos los datos son sintéticos."""
from datetime import timedelta
import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from app.evaluation import DICCIONARIO_FALLOS, MODELO_ECLIPSE, LandingSiteEvaluator
from app.astronomy.lunar_geometry import generar_efemerides
from evaluar import procesar_peticion_frontend


def sitio(lat=-89.65, lon=129.2):
    return {"nombre": "Caso sintético", "lat": lat, "lon": lon, "elevacion_m": -2000.,
            "pendiente_deg": 2., "horizonte_360": [0.] * 360,
            "metadatos": {"resolucion_norte_sur_m": 1895, "fuente": "fixture sintética"}}


def efemerides(horas=336., paso=1., lugar=None):
    lugar = sitio() if lugar is None else lugar
    return {
        "t0_aterrizaje": "2026-11-14T12:00:00Z", "fuente": "fixture sintética",
        "unidades": {"angulos": "deg", "tiempo": "h", "altura": "m"},
        "modelo": {"eclipse": MODELO_ECLIPSE},
        "lugar": {"latitud_deg": lugar["lat"], "longitud_deg": lugar["lon"], "altura_m": lugar["elevacion_m"]},
        "duracion_solicitada_horas": horas, "paso_horas": paso,
        "timeline": [{"hora_offset": i * paso, "sol_elevacion_deg": 20., "sol_azimut_deg": 90.,
                      "tierra_elevacion_deg": 30., "tierra_azimut_deg": 270., "tierra_bloquea_sol": False}
                     for i in range(int(horas / paso) + 1)],
    }


class EvaluadorTests(unittest.TestCase):
    def setUp(self):
        self.evaluador = LandingSiteEvaluator()
        self.sitio = sitio()
        self.ephem = efemerides()

    def evaluar(self, evaluador=None):
        resultado = (evaluador or self.evaluador).evaluar_sitio("prueba", self.sitio, self.ephem)
        json.dumps(resultado, allow_nan=False)
        return resultado

    def test_devuelve_todos_los_fallos_y_diccionario(self):
        self.sitio["pendiente_deg"] = 20
        for fila in self.ephem["timeline"]:
            fila.update(sol_elevacion_deg=-2, tierra_elevacion_deg=-3)
        resultado = self.evaluar()
        self.assertEqual(resultado["fallos"], [1, 4, 5, 6])
        self.assertEqual([f["codigo"] for f in resultado["detalle_fallos"]], resultado["fallos"])
        self.assertEqual(resultado["diccionario_fallos"], DICCIONARIO_FALLOS)
        self.assertFalse(resultado["viable"])
        self.assertTrue(resultado["evaluacion_completa"])
        self.assertEqual(resultado["datos_tecnicos"]["horas_totales_luz"], 0)

    def test_aceptacion_sin_centinela(self):
        resultado = self.evaluar()
        self.assertTrue(resultado["viable"])
        self.assertEqual(resultado["fallos"], [])
        self.assertEqual(resultado["criterios_no_evaluados"], [])
        self.assertIsNone(resultado["datos_tecnicos"]["primera_perdida_luz"])
        self.assertEqual(resultado["datos_tecnicos"]["horas_simuladas"], 336)

    def test_p95_prevalece_sobre_maximo_y_se_declara(self):
        self.sitio.update(pendiente_deg=30, pendiente_p95_deg=12)
        resultado = self.evaluar()
        self.assertTrue(resultado["viable"])
        self.assertEqual(resultado["datos_tecnicos"]["pendiente_evaluada_deg"], 12)
        self.assertEqual(resultado["datos_tecnicos"]["criterio_pendiente"], "pendiente_p95_deg")

    def test_p95_limite_exclusivo_y_rechazo(self):
        for valor in (15, 20):
            with self.subTest(valor=valor):
                self.sitio.update(pendiente_deg=30, pendiente_p95_deg=valor)
                resultado = self.evaluar()
                self.assertFalse(resultado["viable"])
                self.assertEqual(resultado["fallos"], [1])

    def test_p95_invalido_no_se_sustituye_por_maximo(self):
        for valor in (None, float("nan"), float("inf"), True, "2", -1, 91):
            with self.subTest(valor=valor):
                self.sitio["pendiente_p95_deg"] = valor
                resultado = self.evaluar()
                self.assertIsNone(resultado["viable"])
                self.assertEqual(resultado["fallos"], [2])

    def test_json_anterior_conserva_maximo_con_criterio_explicito(self):
        self.sitio["pendiente_deg"] = 20
        resultado = self.evaluar()
        self.assertFalse(resultado["viable"])
        self.assertEqual(resultado["datos_tecnicos"]["criterio_pendiente"], "pendiente_deg")

    def test_24_horas_independientes_del_paso(self):
        for paso in (0.5, 1, 2):
            with self.subTest(paso=paso):
                self.ephem = efemerides(24, paso)
                resultado = self.evaluar()
                self.assertEqual(resultado["datos_tecnicos"]["horas_totales_luz"], 24)
                self.assertEqual(resultado["datos_tecnicos"]["horas_totales_comunicacion"], 24)
                self.assertEqual(resultado["datos_tecnicos"]["horas_simuladas"], 24)
                self.assertEqual(resultado["fallos"], [])
                self.assertTrue(resultado["viable"])
                self.assertEqual(resultado["estado"], "viable")
                self.assertEqual(resultado["datos_tecnicos"]["requisito_exclusivo_luz_horas"], 12)

    def test_elevacion_baja_sin_relieve_no_produce_fallo_3(self):
        for elevacion in (-90, -2, 0, 0.5, 4, 5):
            with self.subTest(elevacion=elevacion):
                self.ephem["timeline"][0]["sol_elevacion_deg"] = elevacion
                resultado = self.evaluar()
                self.assertEqual(resultado["fallos"], [5])
                self.assertTrue(resultado["evaluacion_completa"])

    def test_relieve_inicial_con_sol_alto_produce_solo_fallo_3(self):
        self.sitio["horizonte_360"][90] = 25
        resultado = self.evaluar()
        self.assertEqual(resultado["fallos"], [3, 6])
        self.assertEqual(resultado["detalle_fallos"][0]["datos_tecnicos"]["causas"], ["relieve"])
        self.assertEqual(resultado["datos_tecnicos"]["horas_luz_sin_relieve"], 336)
        self.assertEqual(resultado["datos_tecnicos"]["horas_perdidas_por_relieve"], 336)
        # Tras el aterrizaje cambia el acimut y vuelve a haber luz.
        for fila in self.ephem["timeline"][1:]:
            fila["sol_azimut_deg"] = 180
        resultado = self.evaluar()
        self.assertEqual(resultado["fallos"], [3])
        self.assertEqual(resultado["datos_tecnicos"]["horas_perdidas_por_relieve"], 1)

    def test_sol_bajo_y_relieve_son_fallos_independientes(self):
        self.ephem["timeline"][0]["sol_elevacion_deg"] = 2
        self.sitio["horizonte_360"][90] = 10
        self.assertEqual(self.evaluar()["fallos"], [3, 5])
        self.ephem["timeline"][0]["sol_elevacion_deg"] = -2
        self.assertEqual(self.evaluar()["fallos"], [5])

    def test_eclipse_bajo_horizonte_no_duplica_fallo_5(self):
        self.ephem["timeline"][0].update(sol_elevacion_deg=-2, tierra_bloquea_sol=True)
        self.assertEqual(self.evaluar()["fallos"], [5])

    def test_horas_sombra_relieve_excluyen_noche_y_eclipse(self):
        self.ephem = efemerides(4)
        self.sitio["horizonte_360"][90] = 25
        self.ephem["timeline"][0]["sol_azimut_deg"] = 180
        self.ephem["timeline"][2]["sol_elevacion_deg"] = -2
        self.ephem["timeline"][3]["tierra_bloquea_sol"] = True
        datos = self.evaluar()["datos_tecnicos"]
        self.assertEqual(datos["horas_totales_luz"], 1)
        self.assertEqual(datos["horas_luz_sin_relieve"], 2)
        self.assertEqual(datos["horas_perdidas_por_relieve"], 1)

    def test_porcentaje_luz_configurable_y_limite_exclusivo(self):
        for porcentaje in (0, 25, 50, 75, 100):
            for horas_luz in (0, 1, 2, 3, 4):
                with self.subTest(porcentaje=porcentaje, horas_luz=horas_luz):
                    self.ephem = efemerides(4)
                    for fila in self.ephem["timeline"][horas_luz:]:
                        fila["tierra_bloquea_sol"] = True
                    resultado = self.evaluar(LandingSiteEvaluator(min_porcentaje_luz=porcentaje))
                    self.assertEqual(6 in resultado["fallos"], horas_luz <= 4 * porcentaje / 100)
                    self.assertNotIn(7, resultado["fallos"])
                    self.assertTrue(resultado["evaluacion_completa"])
                    self.assertEqual(resultado["datos_tecnicos"]["porcentaje_luz"], horas_luz / 4 * 100)

    def test_requisito_se_calcula_sobre_horas_solicitadas(self):
        self.ephem = efemerides(24)
        self.ephem["timeline"] = self.ephem["timeline"][:13]
        resultado = self.evaluar()
        self.assertEqual(resultado["fallos"], [7])
        self.assertEqual(resultado["datos_tecnicos"]["requisito_exclusivo_luz_horas"], 12)
        self.assertEqual(resultado["datos_tecnicos"]["porcentaje_luz"], 50)
        self.assertIsNone(resultado["viable"])

    def test_horas_absolutas_explicitas_conservan_configuracion_anterior(self):
        resultado = self.evaluar(LandingSiteEvaluator(min_horas_supervivencia=336))
        self.assertEqual(resultado["fallos"], [6])
        self.assertEqual(resultado["datos_tecnicos"]["requisito_exclusivo_luz_horas"], 336)

    def test_eclipse_inicial_aunque_haya_luz_suficiente_despues(self):
        self.ephem["timeline"][0]["tierra_bloquea_sol"] = True
        resultado = self.evaluar()
        self.assertEqual(resultado["fallos"], [3])
        self.assertEqual(resultado["datos_tecnicos"]["horas_totales_luz"], 335)
        self.assertEqual(resultado["datos_tecnicos"]["horas_perdidas_por_eclipse"], 1)

    def test_no_recalcula_eclipse_con_umbral_angular(self):
        for fila in self.ephem["timeline"]:
            fila.update(tierra_elevacion_deg=20, tierra_azimut_deg=90)
        self.assertTrue(self.evaluar()["viable"])

    def test_eventos_fraccionarios_y_intervalo_entre_muestras(self):
        self.ephem = efemerides(2, 0.5)
        for fila in self.ephem["timeline"][1:]:
            fila.update(sol_elevacion_deg=-1, tierra_elevacion_deg=-1)
        resultado = self.evaluar(LandingSiteEvaluator(min_horas_supervivencia=0))
        metricas = resultado["datos_tecnicos"]
        self.assertEqual(metricas["horas_totales_luz"], 0.5)
        self.assertEqual(metricas["primera_perdida_luz"], {"hora_detectada": 0.5, "intervalo_horas": [0, 0.5]})
        self.assertEqual(metricas["primera_perdida_comunicacion"]["hora_detectada"], 0.5)

    def test_extremo_final_no_suma_duracion(self):
        self.ephem = efemerides(1)
        self.ephem["timeline"][-1]["tierra_bloquea_sol"] = True
        datos = self.evaluar()["datos_tecnicos"]
        self.assertEqual(datos["horas_totales_luz"], 1)
        self.assertEqual(datos["horas_perdidas_por_eclipse"], 0)
        self.assertEqual(datos["primera_perdida_luz"]["hora_detectada"], 1)

    def test_instante_unico_no_inventa_una_hora(self):
        self.ephem = efemerides(0)
        resultado = self.evaluar()
        self.assertEqual(resultado["datos_tecnicos"]["horas_totales_luz"], 0)
        self.assertEqual(resultado["fallos"], [7])

    def test_tramo_final_no_muestreado_es_cobertura_incompleta(self):
        self.ephem = efemerides(24.5)
        resultado = self.evaluar(LandingSiteEvaluator(min_horas_supervivencia=0))
        self.assertEqual(resultado["datos_tecnicos"]["horas_simuladas"], 24)
        self.assertEqual(resultado["fallos"], [7])
        self.assertFalse(resultado["cobertura_temporal"]["completa"])

    def test_umbrales_originales_son_exclusivos(self):
        self.sitio["pendiente_deg"] = 15
        self.ephem["timeline"][0].update(sol_elevacion_deg=0.5, tierra_elevacion_deg=0)
        self.assertEqual(self.evaluar()["fallos"], [1, 4, 5])
        self.sitio["horizonte_360"][90] = 0.1
        self.assertEqual(self.evaluar()["fallos"], [1, 3, 4, 5])
        self.sitio["horizonte_360"][90] = 0
        self.ephem["timeline"][0]["sol_elevacion_deg"] = 5
        self.assertEqual(self.evaluar()["fallos"], [1, 4, 5])
        self.ephem["timeline"][0]["sol_elevacion_deg"] = 20
        self.ephem["timeline"][0]["tierra_elevacion_deg"] = 30
        self.sitio["horizonte_360"][90] = 19.5
        self.ephem["timeline"][0]["sol_azimut_deg"] = 90
        for fila in self.ephem["timeline"][1:]:
            fila["sol_azimut_deg"] = 180
        self.assertEqual(self.evaluar()["fallos"], [1, 3])
        self.sitio["horizonte_360"][90] = 0
        self.sitio["pendiente_deg"] = 2
        self.ephem = efemerides(24)
        for fila in self.ephem["timeline"][12:]:
            fila["tierra_bloquea_sol"] = True
        resultado = self.evaluar()
        self.assertEqual(resultado["datos_tecnicos"]["horas_totales_luz"], 12)
        self.assertEqual(resultado["fallos"], [6])
        self.ephem = efemerides(120)
        self.assertEqual(self.evaluar()["fallos"], [])

    def test_datos_invalidos_no_ocultan_fallos_independientes(self):
        self.sitio["pendiente_deg"] = 20
        self.sitio["horizonte_360"] = [0] * 359
        self.ephem["timeline"][0]["sol_elevacion_deg"] = 4
        resultado = self.evaluar()
        self.assertEqual(resultado["fallos"], [1, 2, 5])
        self.assertFalse(resultado["evaluacion_completa"])

    def test_falta_radio_no_oculta_criterio_de_luz(self):
        for fila in self.ephem["timeline"]:
            fila.update(sol_elevacion_deg=-1, tierra_azimut_deg=None)
        self.assertEqual(self.evaluar()["fallos"], [2, 5, 6])

    def test_rechazo_inicial_conocido_aunque_falte_otro_dato(self):
        self.ephem["timeline"][0].update(sol_elevacion_deg=-1, tierra_bloquea_sol=None)
        self.assertEqual(self.evaluar()["fallos"], [2, 5])
        self.ephem = efemerides()
        self.sitio["horizonte_360"] = []
        self.ephem["timeline"][0]["tierra_bloquea_sol"] = True
        self.assertEqual(self.evaluar()["fallos"], [2, 3])

    def test_pendiente_obligatoria_y_numeros_finitos(self):
        for valor in (None, float("nan"), float("inf"), True, "2", -1, 91):
            with self.subTest(valor=valor):
                self.sitio["pendiente_deg"] = valor
                resultado = self.evaluar()
                self.assertIsNone(resultado["viable"])
                self.assertIn(2, resultado["fallos"])
        del self.sitio["pendiente_deg"]
        self.assertIsNone(self.evaluar()["viable"])

    def test_validacion_timeline_y_tiempos(self):
        for campo, valor in (("timeline", {}), ("timeline", []), ("timeline", [None]),
                             ("t0_aterrizaje", "2026-11-14T12:00:00")):
            with self.subTest(campo=campo, valor=valor):
                self.ephem = efemerides()
                self.ephem[campo] = valor
                self.assertIn(2, self.evaluar()["fallos"])
        for offsets in ([1, 2], [0, 0], [0, 2, 1], [0, float("nan")], [0, 2]):
            with self.subTest(offsets=offsets):
                self.ephem = efemerides(2)
                self.ephem["timeline"] = self.ephem["timeline"][:len(offsets)]
                for fila, offset in zip(self.ephem["timeline"], offsets):
                    fila["hora_offset"] = offset
                self.assertIn(2, self.evaluar()["fallos"])

    def test_offsets_irregulares_sin_cadencia_declarada(self):
        self.ephem = efemerides(2)
        self.ephem.pop("paso_horas")
        self.ephem["timeline"][1]["hora_offset"] = 0.3
        self.assertEqual(self.evaluar()["datos_tecnicos"]["horas_totales_luz"], 2)

    def test_acimut_null_en_cenit_y_nadir(self):
        for fila in self.ephem["timeline"]:
            fila.update(sol_elevacion_deg=90, sol_azimut_deg=None)
        self.assertTrue(self.evaluar()["viable"])
        for fila in self.ephem["timeline"]:
            fila["sol_elevacion_deg"] = -90
        self.assertEqual(self.evaluar()["fallos"], [5, 6])

    def test_acimut_null_no_vertical_es_dato_insuficiente(self):
        self.ephem["timeline"][0]["sol_azimut_deg"] = None
        self.assertIn(2, self.evaluar()["fallos"])
        self.assertIsNone(self.evaluar()["viable"])

    def test_horizonte_circular(self):
        horizonte = [0] * 360
        horizonte[0] = 10
        self.assertEqual(self.evaluador.obtener_elevacion_horizonte(horizonte, 359.8), (0, 10))

    def test_metadatos_ausentes_o_incompatibles(self):
        for cambio in ({"lugar": {}}, {"unidades": {}}, {"modelo": {}}, {"fuente": None}):
            with self.subTest(cambio=cambio):
                self.ephem = efemerides()
                self.ephem.update(cambio)
                self.assertIsNone(self.evaluar()["viable"])
        for campo, valor in (("latitud_deg", 0), ("longitud_deg", 0), ("altura_m", 0), ("altura_m", float("nan"))):
            self.ephem = efemerides()
            self.ephem["lugar"][campo] = valor
            self.assertIsNone(self.evaluar()["viable"])

    def test_longitudes_equivalentes(self):
        self.sitio["lon"] = -10
        self.ephem["lugar"]["longitud_deg"] = 350
        self.assertTrue(self.evaluar()["viable"])

    def test_eclipse_obligatorio_booleano(self):
        for valor in (None, 0, 1, "false"):
            self.ephem["timeline"][0]["tierra_bloquea_sol"] = valor
            self.assertIsNone(self.evaluar()["viable"])
        del self.ephem["timeline"][0]["tierra_bloquea_sol"]
        self.assertIn(2, self.evaluar()["fallos"])

    def test_series_propias_por_sitio_y_error_aislado(self):
        segundo = sitio(0.674, 23.473)
        payload = {"sitios": {"polar": self.sitio, "ecuatorial": segundo}, "ephemeris": self.ephem}
        salida = self.evaluador.evaluar_dataset_completo(payload)
        self.assertTrue(all(2 in resultado["fallos"] for resultado in salida.values()))
        payload["ephemeris_por_sitio"] = {"polar": self.ephem, "ecuatorial": efemerides(lugar=segundo)}
        salida = self.evaluador.evaluar_dataset_completo(payload)
        self.assertTrue(all(resultado["viable"] for resultado in salida.values()))
        payload["ephemeris_por_sitio"]["polar"] = None
        salida = self.evaluador.evaluar_dataset_completo(payload)
        self.assertIsNone(salida["polar"]["viable"])
        self.assertTrue(salida["ecuatorial"]["viable"])

    def test_configuracion_invalida(self):
        for parametros in ({"min_horas_supervivencia": -1}, {"max_pendiente_deg": float("nan")},
                           {"min_delta_sol_t0_deg": True}, {"min_porcentaje_luz": -1},
                           {"min_porcentaje_luz": 101}, {"min_porcentaje_luz": True},
                           {"min_porcentaje_luz": float("nan")}, {"min_porcentaje_luz": float("inf")},
                           {"min_porcentaje_luz": "50"}, {"min_porcentaje_luz": None}):
            with self.assertRaises(ValueError):
                LandingSiteEvaluator(**parametros)


def tabla_sintetica(inicio, duracion, paso, **kwargs):
    fechas = pd.date_range(pd.Timestamp(inicio), periods=duracion // paso + 1, freq=paso)
    return pd.DataFrame({"tiempo_utc": fechas, "t_segundos": (fechas - fechas[0]).total_seconds(),
                         "elevacion_sol_deg": 20., "acimut_sol_deg": 90.,
                         "elevacion_tierra_deg": 30., "acimut_tierra_deg": 270., "tierra_bloquea_sol": False})


class FlujoLocalTests(unittest.TestCase):
    def setUp(self):
        datos = sitio()
        self.terreno = {"latitud": datos["lat"], "longitud": datos["lon"],
                        **{k: datos[k] for k in ("elevacion_m", "pendiente_deg", "horizonte_360", "metadatos")}}
        self.mock_terreno = patch("evaluar.calcular_terreno", return_value=self.terreno).start()
        self.mock_geometria = patch("app.astronomy.lunar_geometry.calcular_desde_lugar", side_effect=tabla_sintetica).start()
        patch("requests.sessions.Session.request", side_effect=AssertionError("No se permite red en estas pruebas")).start()
        self.addCleanup(patch.stopall)

    def procesar(self, **kwargs):
        return procesar_peticion_frontend("2026-11-14T14:00:00+02:00", -89.65, 129.2, **kwargs)

    def test_contrato_integracion_pendiente_aceptable_y_archivos(self):
        with TemporaryDirectory() as carpeta:
            resultado = self.procesar(carpeta_salida=carpeta, duracion_horas=336)
            evaluacion = next(iter(resultado["evaluacion"].values()))
            self.assertTrue(evaluacion["viable"])
            self.assertIsInstance(resultado["combinado"]["ephemeris"]["timeline"], list)
            self.assertEqual(resultado["combinado"]["ephemeris"]["t0_aterrizaje"], "2026-11-14T12:00:00Z")
            self.assertEqual(evaluacion["metadatos_terreno"], self.terreno["metadatos"])
            self.assertEqual(len(list(Path(resultado["carpeta"]).iterdir())), 4)
            for clave, ruta in resultado["archivos"].items():
                self.assertEqual(json.loads(Path(ruta).read_text(encoding="utf-8")),
                                 json.loads(json.dumps(resultado[clave])))
            self.assertIsNone(self.mock_terreno.call_args.kwargs["salida"])
            self.assertEqual(self.mock_geometria.call_args.kwargs["altura_m"], -2000.)

    def test_modo_memoria_y_cobertura_por_defecto(self):
        resultado = self.procesar(carpeta_salida=None)
        self.assertIsNone(resultado["carpeta"])
        self.assertEqual(resultado["archivos"], {})
        evaluacion = next(iter(resultado["evaluacion"].values()))
        self.assertEqual(evaluacion["fallos"], [])
        self.assertTrue(evaluacion["viable"])
        self.assertEqual(evaluacion["datos_tecnicos"]["requisito_exclusivo_luz_horas"], 12)

    def test_porcentaje_personalizado_llega_al_informe_guardado(self):
        with TemporaryDirectory() as carpeta:
            resultado = self.procesar(carpeta_salida=carpeta, evaluador=LandingSiteEvaluator(min_porcentaje_luz=75))
            guardado = json.loads(Path(resultado["archivos"]["evaluacion"]).read_text(encoding="utf-8"))
            evaluacion = next(iter(guardado.values()))
            self.assertEqual(evaluacion["parametros_mision"]["min_porcentaje_luz"], 75)
            self.assertEqual(evaluacion["datos_tecnicos"]["requisito_exclusivo_luz_horas"], 18)

    def test_p95_llega_al_evaluador_y_al_json_guardado(self):
        self.terreno.update(pendiente_deg=30, pendiente_p95_deg=12)
        with TemporaryDirectory() as carpeta:
            resultado = self.procesar(carpeta_salida=carpeta, duracion_horas=336)
            evaluacion = next(iter(resultado["evaluacion"].values()))
            self.assertTrue(evaluacion["viable"])
            self.assertEqual(evaluacion["datos_tecnicos"]["pendiente_evaluada_deg"], 12)
            guardado = json.loads(Path(resultado["archivos"]["combinado"]).read_text(encoding="utf-8"))
            self.assertEqual(next(iter(guardado["sitios"].values()))["pendiente_p95_deg"], 12)

    def test_peticion_elimina_anterior_y_conserva_signos(self):
        with TemporaryDirectory() as carpeta:
            uno = self.procesar(carpeta_salida=carpeta)
            dos = procesar_peticion_frontend("2026-11-14T12:00:00Z", 89.65, -129.2, carpeta_salida=carpeta)
            self.assertNotEqual(uno["carpeta"], dos["carpeta"])
            self.assertNotEqual(list(uno["evaluacion"]), list(dos["evaluacion"]))
            self.assertFalse(Path(uno["carpeta"]).exists())
            self.assertEqual(list(Path(carpeta).resolve().glob("peticion_*")), [Path(dos["carpeta"])])

    def test_limpia_antes_del_calculo_incluyendo_formato_antiguo(self):
        with TemporaryDirectory() as carpeta:
            raiz = Path(carpeta)
            for nombre in ("terreno.json", "efemerides.json", "datos_lunares.json", "evaluacion.json"):
                (raiz / nombre).write_text("anterior", encoding="utf-8")
            for nombre in ("peticion_anterior", ".incompleta-abandonada"):
                (raiz / nombre).mkdir()
                (raiz / nombre / "terreno.json").write_text("anterior", encoding="utf-8")
            (raiz / "otro.txt").write_text("conservar", encoding="utf-8")
            (raiz / "cache").mkdir()

            def calcular(**kwargs):
                self.assertEqual({p.name for p in raiz.iterdir()}, {".peticion.lock", "otro.txt", "cache"})
                return self.terreno

            self.mock_terreno.side_effect = calcular
            self.procesar(carpeta_salida=carpeta)
            self.assertEqual((raiz / "otro.txt").read_text(encoding="utf-8"), "conservar")

    def test_peticion_simultanea_se_rechaza_sin_borrar_la_activa(self):
        with TemporaryDirectory() as carpeta:
            def calcular(**kwargs):
                with self.assertRaisesRegex(RuntimeError, "petición en curso"):
                    self.procesar(carpeta_salida=carpeta)
                return self.terreno

            self.mock_terreno.side_effect = calcular
            resultado = self.procesar(carpeta_salida=carpeta)
            self.assertTrue(Path(resultado["archivos"]["evaluacion"]).is_file())

    def test_fallo_calculo_no_publica_resultados_parciales(self):
        with TemporaryDirectory() as carpeta:
            sentinel = Path(carpeta) / "evaluacion.json"
            sentinel.write_text("anterior", encoding="utf-8")
            self.mock_geometria.side_effect = RuntimeError("fallo simulado")
            with self.assertRaises(RuntimeError):
                self.procesar(carpeta_salida=carpeta)
            self.assertFalse(sentinel.exists())
            self.assertEqual([p.name for p in Path(carpeta).iterdir()], [".peticion.lock"])
            self.mock_geometria.side_effect = tabla_sintetica
            self.assertTrue(Path(self.procesar(carpeta_salida=carpeta)["carpeta"]).is_dir())

    def test_fallo_escritura_no_publica_carpeta_parcial(self):
        with TemporaryDirectory() as carpeta:
            anterior = self.procesar(carpeta_salida=carpeta)
            escribir = Path.write_text
            def fallar(ruta, *args, **kwargs):
                if ruta.name == "efemerides.json":
                    raise OSError("fallo de escritura simulado")
                return escribir(ruta, *args, **kwargs)
            with patch.object(Path, "write_text", new=fallar), self.assertRaises(OSError):
                self.procesar(carpeta_salida=carpeta)
            self.assertFalse(Path(anterior["carpeta"]).exists())
            self.assertEqual([p.name for p in Path(carpeta).iterdir()], [".peticion.lock"])
            self.assertTrue(Path(self.procesar(carpeta_salida=carpeta)["carpeta"]).is_dir())

    def test_peticion_invalida_conserva_resultado_anterior(self):
        with TemporaryDirectory() as carpeta:
            anterior = self.procesar(carpeta_salida=carpeta)
            with self.assertRaises(ValueError):
                self.procesar(carpeta_salida=carpeta, duracion_horas=-1)
            self.assertTrue(Path(anterior["archivos"]["evaluacion"]).is_file())

    def test_fallo_limpieza_detiene_calculo_y_libera_bloqueo(self):
        with TemporaryDirectory() as carpeta:
            (Path(carpeta) / "peticion_anterior").mkdir()
            with patch("evaluar.shutil.rmtree", side_effect=PermissionError("sin permiso")):
                with self.assertRaises(PermissionError):
                    self.procesar(carpeta_salida=carpeta)
            self.mock_terreno.assert_not_called()
            self.assertTrue(Path(self.procesar(carpeta_salida=carpeta)["carpeta"]).is_dir())

    def test_peticion_invalida_no_calcula_terreno(self):
        for parametros in ({"duracion_horas": -1}, {"paso_horas": 0}, {"paso_horas": 1.1 / 60},
                           {"duracion_horas": 0.5, "paso_horas": 1}, {"duracion_horas": float("nan")}):
            with self.assertRaises(ValueError):
                self.procesar(carpeta_salida=None, **parametros)
        self.mock_terreno.assert_not_called()

    def test_altura_ausente_no_se_sustituye_por_cero(self):
        del self.terreno["elevacion_m"]
        with self.assertRaises(ValueError):
            self.procesar(carpeta_salida=None)
        self.mock_geometria.assert_not_called()

    def test_generador_no_redondea_offsets_y_conserva_eclipse(self):
        def geometria(*args, **kwargs):
            tabla = tabla_sintetica(*args, **kwargs)
            tabla.loc[0, "tierra_bloquea_sol"] = True
            tabla.loc[0, "acimut_sol_deg"] = np.nan
            return tabla
        self.mock_geometria.side_effect = geometria
        resultado = generar_efemerides("2026-11-14T12:00:00Z", timedelta(minutes=2), timedelta(minutes=1), decimales=0)
        filas = resultado["ephemeris"]["timeline"]
        self.assertEqual([fila["hora_offset"] for fila in filas], [0, 1 / 60, 2 / 60])
        self.assertTrue(filas[0]["tierra_bloquea_sol"])
        self.assertIsNone(filas[0]["sol_azimut_deg"])
        self.assertEqual(resultado["ephemeris"]["modelo"]["eclipse"], MODELO_ECLIPSE)
        json.dumps(resultado, allow_nan=False)


class EntradaUnicaTests(unittest.TestCase):
    def test_cli_desde_otra_carpeta_reevalua_sin_escribir_resultados(self):
        payload = {"sitios": {"prueba": sitio()}, "ephemeris": efemerides(horas=24)}
        for muestra in payload["ephemeris"]["timeline"]:
            if muestra["hora_offset"] >= 16:
                muestra["sol_elevacion_deg"] = -20
        cli = Path(__file__).resolve().parents[1] / "evaluar.py"
        with TemporaryDirectory() as temporal:
            entrada = Path(temporal) / "entrada.json"
            entrada.write_text(json.dumps(payload), encoding="utf-8")
            for porcentaje in (50, 75):
                proceso = subprocess.run(
                    [sys.executable, "-X", "utf8", "-B", str(cli), "--entrada", str(entrada),
                     "--min-porcentaje-luz", str(porcentaje)],
                    cwd=temporal, capture_output=True, text=True, check=True,
                    encoding="utf-8", timeout=30,
                )
                esperado = LandingSiteEvaluator(min_porcentaje_luz=porcentaje).evaluar_dataset_completo(payload)
                self.assertEqual(json.loads(proceso.stdout), json.loads(json.dumps(esperado)))
                self.assertEqual(esperado["prueba"]["viable"], porcentaje == 50)
            self.assertEqual([p.name for p in Path(temporal).iterdir()], ["entrada.json"])


if __name__ == "__main__":
    unittest.main()
