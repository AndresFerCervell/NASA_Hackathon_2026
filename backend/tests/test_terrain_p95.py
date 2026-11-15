"""P95 calculado desde DEM sintéticos; sin acceso a servicios externos."""
import unittest
from unittest.mock import Mock, patch

import numpy as np
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

from app.terrain import _pendiente_30m, calcular_terreno, pendiente_maxima_local


class TerrenoP95Tests(unittest.TestCase):
    def test_plano_inclinado_conserva_p95_no_nulo(self):
        _, cc = np.indices((101, 101))
        z = np.tan(np.deg2rad(10)) * (-500 + 10 * cc)
        with MemoryFile() as archivo:
            with archivo.open(driver="GTiff", width=101, height=101, count=1,
                              dtype="float64",
                              crs="+proj=stere +lat_0=-90 +lat_ts=-90 +R=1737400 +units=m",
                              transform=from_origin(-505, 505, 10, 10)) as ds:
                ds.write(z, 1)
            maxima, detalle = pendiente_maxima_local(-89.999, 0, dem=archivo.name)
        self.assertAlmostEqual(detalle["pendiente_p95_deg"], 10, delta=0.001)
        self.assertLessEqual(detalle["pendiente_p95_deg"], maxima)

    def test_geotiff_pico_aislado_conserva_maximo_y_exporta_p95(self):
        z = np.zeros((101, 101), dtype="float64")
        z[50, 50] = 100
        crs = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m +no_defs"
        with MemoryFile() as archivo:
            with archivo.open(driver="GTiff", width=101, height=101, count=1,
                              dtype="float64", crs=crs,
                              transform=from_origin(-505, 505, 10, 10)) as ds:
                ds.write(z, 1)
            with patch("app.terrain.cargar_lola", return_value=(None, 1)), \
                 patch("app.terrain.elevacion", return_value=0), \
                 patch("app.terrain.horizonte", return_value=np.zeros(360)):
                resultado = calcular_terreno(-89.999, 0, dem_local=archivo.name, salida=None)
            self.assertGreater(resultado["pendiente_deg"], 15)
            self.assertEqual(resultado["pendiente_p95_deg"], 0)
            self.assertEqual(resultado["metadatos"]["pendiente"]["pendiente_p95_deg"], 0)

    def test_geotiff_sin_cobertura_no_descarta_nan_para_obtener_p95(self):
        z = np.zeros((101, 101), dtype="float64")
        z[50, 50] = -9999
        with MemoryFile() as archivo:
            with archivo.open(driver="GTiff", width=101, height=101, count=1,
                              dtype="float64", nodata=-9999,
                              crs="+proj=stere +lat_0=-90 +lat_ts=-90 +R=1737400 +units=m",
                              transform=from_origin(-505, 505, 10, 10)) as ds:
                ds.write(z, 1)
            with self.assertRaisesRegex(ValueError, "cobertura válida"):
                pendiente_maxima_local(-89.999, 0, dem=archivo.name)

    def test_tile_cilindrico_tambien_calcula_p95(self):
        z = np.zeros((64, 64), dtype="<i2")
        z[30, 30] = 200  # 100 m de altura, escala vertical 0.5.
        etiqueta = "LINES = 64\nLINE_SAMPLES = 64\nMAP_RESOLUTION = 1024\nSAMPLE_BITS = 16\nOFFSET = 1737400\nSCALING_FACTOR = 0.5\n"

        def respuesta(url, **kwargs):
            r = Mock(status_code=200, text=etiqueta)
            if url.endswith(".img"):
                inicio, fin = map(int, kwargs["headers"]["Range"].split("=")[1].split("-"))
                r.status_code = 206
                r.headers = {"Content-Range": f"bytes {inicio}-{fin}/{z.nbytes}"}
                r.content = z.tobytes()[inicio:fin+1]
            r.__enter__ = Mock(return_value=r)
            r.__exit__ = Mock(return_value=False)
            return r

        with patch("app.terrain.requests.get", side_effect=respuesta):
            maxima, detalle = _pendiente_30m(15 - 30.5 / 1024, 30.5 / 1024, 300)
        self.assertGreater(maxima, 15)
        self.assertEqual(detalle["pendiente_p95_deg"], 0)


if __name__ == "__main__":
    unittest.main()
