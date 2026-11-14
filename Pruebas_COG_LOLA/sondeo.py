"""Sondeo pequeño y reproducible; nunca consume una respuesta completa grande."""
import json
from pathlib import Path
from urllib.parse import urljoin
import requests
import rasterio

session = requests.Session()
session.headers['User-Agent'] = 'Pruebas-COG-LOLA/1.0 scientific-prototype'
urls = [
    'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF',
    'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_83S_10MPP_ADJ.TIF',
    'https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site04/Site04_final_adj_5mpp_surf.tif',
]
results = []
for url in urls:
    record = {'url': url}
    try:
        with session.get(url, headers={'Range':'bytes=0-16383','Accept-Encoding':'identity'}, stream=True, timeout=30) as response:
            record.update(status=response.status_code, headers=dict(response.headers))
            if response.status_code != 206:
                raise RuntimeError('Sin HTTP 206: se cierra sin descargar el archivo.')
            record['bytes_read'] = len(response.raw.read(16384))
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.TIF,.tif', GDAL_HTTP_TIMEOUT='30', GDAL_HTTP_MAX_RETRY='1'):
            with rasterio.open('/vsicurl/'+url) as src:
                record.update(crs=src.crs.to_wkt(), transform=list(src.transform), bounds=list(src.bounds), shape=src.shape, res=src.res, nodata=src.nodata, scales=src.scales, offsets=src.offsets, units=src.units, overviews=src.overviews(1), image_structure=src.tags(ns='IMAGE_STRUCTURE'), tags=src.tags(), blocks=src.block_shapes)
                arr=src.read(1, window=rasterio.windows.Window(src.width//2,src.height//2,8,8), masked=True)
                record['sample']=arr.filled(float('nan')).tolist()
    except Exception as exc:
        record['error']=str(exc)
    results.append(record)
    print(json.dumps(record, ensure_ascii=True), flush=True)
for url in ['https://imbrium.mit.edu/DATA/SLDEM2015/README','https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/README','https://imbrium.mit.edu/DATA/SLDEM2015/TILES/FLOAT_IMG/']:
    try:
        r=session.get(url,timeout=30);r.raise_for_status()
        print(url, r.text[:15000], flush=True)
    except Exception as exc:
        print(url, str(exc), flush=True)
Path('Pruebas_COG_LOLA/sondeo_fuentes.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
