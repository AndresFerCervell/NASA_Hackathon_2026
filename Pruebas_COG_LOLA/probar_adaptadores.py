"""Pruebas de integración pequeñas de perfiles/Horizons, sin barrido lunar extenso."""
import nbformat
import numpy as np

nb=nbformat.read('Pruebas_COG_LOLA.ipynb',as_version=4)
ns={}
for cell in nb.cells[:19]:
    if cell.cell_type=='code': exec(compile(cell.source,'<notebook>','exec'),ns)

print('PROFILE',flush=True)
p=ns['get_elevation_profile'](.674,23.473,90.,np.array([100.,200.,300.]),80.)
assert np.isfinite(p['elevation_m']).all()
print({k:v for k,v in p.items() if k!='datasets'},flush=True)
print('HORIZONS',flush=True)
try:
    hp=ns['horizons_positions'](.674,23.473,-1900.,'1969-07-20T20:17:40Z',
                              '1969-07-20T20:18:40Z','1 min','10')
    print(hp['header'],hp['azimuth_deg'],hp['elevation_deg'],hp['angular_diameter_deg'],flush=True)
except Exception as exc:
    print('ERROR HORIZONS',repr(exc),flush=True)
    raise

# Proveedor esférico conocido: prueba el cierre, iteración, barrido y serie sin depender
# de miles de accesos remotos. Nunca se usa como sustituto del DEM real en los experimentos.
original_elevation=ns['get_elevation']
original_profile=ns['get_elevation_profile']
original_positions=ns['horizons_positions']
ns['get_elevation']=lambda *a:0.
def sphere_profile(lat,lon,az,distances,target_resolution=80.):
    d=np.asarray(distances)
    lons,lats,_=ns['GEOD'].fwd(np.full(d.size,lon),np.full(d.size,lat),np.full(d.size,az),d)
    return dict(distances_m=d,latitude=lats,longitude=lons,elevation_m=np.zeros(d.size),
                actual_spacing_m=np.full(d.size,target_resolution),datasets=['synthetic sphere'])
ns['get_elevation_profile']=sphere_profile
h=ns['calculate_horizon_angle'](0.,0.,90.,2.)
print('HORIZON CLOSURE', {k:h[k] for k in ('angle_deg','max_distance_m','distance_closed','tail_upper_bound_deg')},flush=True)
assert h['distance_closed'] and h['max_distance_m']>100000
assert abs(h['angle_deg']-ns['smooth_horizon'](0.,2.))<.001
full=ns['calculate_full_horizon'](0.,0.,2.,90.)
assert len(full['angle_deg'])==4
print('SYNTHETIC HORIZON INTEGRATION OK',h['angle_deg'],h['max_distance_m'],flush=True)
def positions(lat,lon,alt,start,end,step,target):
    t=ns['parse_utc'](start)
    times=[t+ns['timedelta'](hours=i) for i in range(4)]
    return dict(time=times,azimuth_deg=np.array([359.,1.,90.,180.]),
                elevation_deg=np.array([1.,-1.,2.,-2.]),angular_diameter_deg=np.full(4,.5))
ns['horizons_positions']=positions
r=ns['evaluate_visibility_over_time'](0.,0.,'2026-01-01T00:00:00Z',
    '2026-01-01T04:00:00Z','1 h',full)
assert r['sun']['model_visible_time_pct']==50.
print('SYNTHETIC TIME ADAPTER OK',flush=True)
