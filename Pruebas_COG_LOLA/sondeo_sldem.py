import requests, rasterio, json
from pathlib import Path
base='https://imbrium.mit.edu/DATA/SLDEM2015/TILES/FLOAT_IMG/'
label='SLDEM2015_512_00N_30N_000_045_FLOAT.LBL'
r=requests.get(base+label,timeout=30);r.raise_for_status()
print(r.text,flush=True)
Path('Pruebas_COG_LOLA/Apolo11.LBL.txt').write_text(r.text,encoding='utf-8')
with requests.get(base+label.replace('.LBL','.IMG'),headers={'Range':'bytes=0-1023'},stream=True,timeout=30) as r:
    print(r.status_code,dict(r.headers),flush=True)
    if r.status_code==206: print(len(r.raw.read(1024)),flush=True)
with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR',CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.LBL,.IMG',GDAL_HTTP_TIMEOUT='30'):
    with rasterio.open('/vsicurl/'+base+label) as s:
        print(s.profile,s.scales,s.offsets,s.tags(),flush=True)
        print(s.read(1,window=rasterio.windows.Window(12000,15000,8,8)),flush=True)
