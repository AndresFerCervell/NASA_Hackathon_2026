"""Deterministic API tests: no network or ephemeris kernel download."""
from __future__ import annotations

import json
import unittest
from unittest.mock import Mock, patch

import numpy as np
import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.astronomy.lunar_geometry import (
    HorizonsError,
    HorizonsTimeout,
    angulos_locales,
    tierra_bloquea_segmento_sol,
)
from app.lunar_api import _query_lock, router

PAYLOAD = {
    "lugar": {"nombre": "Apolo 11", "latitud_deg": 0.67416, "longitud_deg": 23.47314, "altura_m": 0.0},
    "inicio_utc": "1969-07-20T20:17:40Z",
    "duracion_segundos": 0,
    "paso_segundos": 600,
}


def vector_response(*args, **kwargs):
    """Synthetic ICRF: local up +X, north +Z, east +Y."""
    params = kwargs["params"]
    target = params["COMMAND"]
    if target == "'399'":
        vector = (400000, 0, 0)  # Earth at zenith: null azimuth.
    elif target == "'10'":
        vector = (100000000, 100000000, 0)  # Sun above eastern horizon.
    elif params["SITE_COORD"] == "'0,90,0'":
        vector = (0, 0, -1737.4)
    else:
        vector = (-1737.4, 0, 0)
    text = f"$$SOE\n2440423.3456, A.D. 1969-Jul-20 20:17:40.000, {vector[0]}, {vector[1]}, {vector[2]},\n$$EOE"
    response = Mock()
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    response.iter_content.return_value = [json.dumps({"result": text}).encode()]
    return response


class LunarApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)

    @patch("app.astronomy.lunar_geometry.requests.Session.get", side_effect=vector_response)
    def test_frontend_to_horizons_and_json_null(self, get):
        response = self.client.post("/api/lunar-geometry", json=PAYLOAD)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["total_muestras"], 1)
        row = body["datos"][0]
        self.assertAlmostEqual(row["elevacion_sol_deg"], 45)
        self.assertEqual(row["acimut_sol_deg"], 90)
        self.assertIsNone(row["acimut_tierra_deg"])
        self.assertTrue(row["conexion_tierra"])
        self.assertTrue(row["iluminado_sin_terreno"])
        self.assertEqual(get.call_count, 4)
        params = get.call_args_list[0].kwargs["params"]
        self.assertEqual(params["TIME_TYPE"], "'UT'")
        self.assertEqual(params["CENTER"], "'coord@301'")
        self.assertIn("23.4731400000,0.6741600000,0.0000000000", params["SITE_COORD"])
        self.assertNotIn("NaN", response.text)

    @patch("app.astronomy.lunar_geometry.requests.Session.get", side_effect=vector_response)
    def test_height_and_offset_are_converted(self, get):
        payload = {**PAYLOAD, "inicio_utc": "1969-07-20T22:17:40+02:00",
                   "lugar": {**PAYLOAD["lugar"], "altura_m": 1000}}
        response = self.client.post("/api/lunar-geometry", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        params = get.call_args_list[0].kwargs["params"]
        self.assertEqual(params["TLIST"], "'1969-07-20 20:17:40'")
        self.assertIn("1.0000000000", params["SITE_COORD"])

    @patch("app.lunar_api.calcular_desde_lugar")
    def test_invalid_payloads_do_not_contact_horizons(self, calculate):
        invalid = [
            {"lugar": {**PAYLOAD["lugar"], "latitud_deg": 91}},
            {"lugar": {**PAYLOAD["lugar"], "altura_m": "1000"}},
            {"inicio_utc": "1969-07-20T20:17:40"},
            {"inicio_utc": "1969-07-20T20:17:40.123Z"},
            {"inicio_utc": 123456789},
            {"duracion_segundos": -1},
            {"paso_segundos": 30},
            {"paso_segundos": 61},
            {"duracion_segundos": True},
            {"duracion_segundos": 10000 * 60, "paso_segundos": 60},
            {"duracion_segundos": 1},
            {"url": "https://example.com"},
            {"inicio_utc": "2100-12-31T23:59:00Z", "duracion_segundos": 3600},
        ]
        for change in invalid:
            with self.subTest(change=change):
                response = self.client.post("/api/lunar-geometry", json={**PAYLOAD, **change})
                self.assertEqual(response.status_code, 422, response.text)
        calculate.assert_not_called()

    def test_busy_rejected_without_queue(self):
        with _query_lock:
            response = self.client.post("/api/lunar-geometry", json=PAYLOAD)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["Retry-After"], "5")

    def test_upstream_errors_release_lock(self):
        for error, status in [(HorizonsError("private upstream detail"), 502),
                              (HorizonsTimeout("timeout"), 504)]:
            with patch("app.lunar_api.calcular_desde_lugar", side_effect=error):
                response = self.client.post("/api/lunar-geometry", json=PAYLOAD)
            self.assertEqual(response.status_code, status)
            self.assertNotIn("private", response.text)
            self.assertFalse(_query_lock.locked())

    @patch("app.astronomy.lunar_geometry.requests.Session.get", side_effect=requests.Timeout)
    def test_network_timeout(self, get):
        response = self.client.post("/api/lunar-geometry", json=PAYLOAD)
        self.assertEqual(response.status_code, 504)

    @patch("app.astronomy.lunar_geometry.requests.Session.get", side_effect=vector_response)
    def test_incomplete_series_fails_instead_of_fabricating_data(self, get):
        payload = {**PAYLOAD, "duracion_segundos": 1200}
        response = self.client.post("/api/lunar-geometry", json=payload)
        self.assertEqual(response.status_code, 502)

    @patch("app.astronomy.lunar_geometry.requests.Session.get", side_effect=vector_response)
    def test_malformed_csv_is_upstream_failure(self, get):
        response = vector_response(params={"COMMAND": "'10'"})
        response.iter_content.return_value = [json.dumps({"result": "$$SOE\n0,A.D. bad-date bad-time,1,2,3\n$$EOE"}).encode()]
        get.side_effect = None
        get.return_value = response
        result = self.client.post("/api/lunar-geometry", json=PAYLOAD)
        self.assertEqual(result.status_code, 502)

    @patch("app.astronomy.lunar_geometry.requests.Session.get", side_effect=vector_response)
    def test_unexpected_upstream_json_is_not_internal_error(self, get):
        for content in ({"result": {"unexpected": True}}, ["unexpected"], {"error": "no ephemeris"}):
            response = vector_response(params={"COMMAND": "'10'"})
            response.iter_content.return_value = [json.dumps(content).encode()]
            get.side_effect = None
            get.return_value = response
            result = self.client.post("/api/lunar-geometry", json=PAYLOAD)
            self.assertEqual(result.status_code, 502)

    @patch("app.astronomy.lunar_geometry.MAX_RESPONSE_BYTES", 10)
    @patch("app.astronomy.lunar_geometry.requests.Session.get", side_effect=vector_response)
    def test_oversized_upstream_response_is_rejected(self, get):
        response = self.client.post("/api/lunar-geometry", json=PAYLOAD)
        self.assertEqual(response.status_code, 502)


class GeometryTests(unittest.TestCase):
    def test_cardinal_axes_and_undefined_azimuth(self):
        vectors = np.array([[0., 0, 1], [0, 1, 0], [0, 0, -1], [0, -1, 0], [1, 0, 0], [-1, 0, 0]])
        _, elevation, azimuth, theta = angulos_locales(
            vectors, np.tile([1., 0, 0], (6, 1)), np.tile([0., 0, 1], (6, 1)))
        np.testing.assert_allclose(azimuth[:4], [0, 90, 180, 270])
        np.testing.assert_allclose(elevation, [0, 0, 0, 0, 90, -90])
        np.testing.assert_allclose(elevation + theta, 90)
        self.assertTrue(np.isnan(azimuth[4:]).all())

    def test_earth_intersection_requires_finite_segment(self):
        sun = np.array([[100., 0, 0]] * 5)
        earth = np.array([[50., 0, 0], [-50, 0, 0], [150, 0, 0], [50, 2, 0], [50, 1, 0]])
        np.testing.assert_array_equal(tierra_bloquea_segmento_sol(sun, earth, 1),
                                      [True, False, False, False, True])


if __name__ == "__main__":
    unittest.main()
