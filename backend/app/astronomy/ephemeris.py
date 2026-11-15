"""NASA/JPL DE440s ephemeris calculations powered by Skyfield."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from skyfield.api import Loader

DEG2RAD = math.pi / 180.0
RAD2DEG = 180.0 / math.pi
AU_KM = 149_597_870.7
PERIHELION_LON_DEG = 102.9373

CURATED_SITES: dict[str, dict[str, object]] = {
    "im1-odysseus": {
        "name": "IM-1 Odysseus (Malapert A)",
        "lat": -80.13,
        "lon": 1.44,
    },
    "artemis3-shackleton": {
        "name": "Artemis III (Shackleton Rim)",
        "lat": -89.68,
        "lon": 129.0,
    },
    "apollo-11": {
        "name": "Apollo 11 (Tranquility Base)",
        "lat": 0.67,
        "lon": 23.47,
    },
}

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class CalendarUTC:
    year: int
    month: int
    day: int
    hour: float


@dataclass(frozen=True)
class OrbitalTelemetry:
    JD: float
    d: float
    M_E: float
    C_E: float
    v_E: float
    lambdaE: float
    lambdaSun: float
    rE_AU: float
    rE_km: float
    xE: float
    yE: float
    lambdaM: float
    betaM: float
    omegaM: float
    rM_km: float
    elongation: float
    illuminatedFraction: float
    phaseName: str
    GMST_deg: float
    source: str


@dataclass(frozen=True)
class TrajectoryPoint:
    JD: float
    lambdaE: float
    rE_AU: float
    lambdaM: float
    betaM: float
    rM_km: float


@lru_cache(maxsize=1)
def _get_skyfield_context():
    loader = Loader(str(DATA_DIR))
    ts = loader.timescale()
    eph = loader("de440s.bsp")
    return ts, eph["sun"], eph["earth"], eph["moon"]


def mod360(angle: float) -> float:
    return ((angle % 360.0) + 360.0) % 360.0


def compute_julian_date(year: int, month: int, day: int, hour: float) -> float:
    y1 = year
    m1 = month
    if month <= 2:
        y1 = year - 1
        m1 = month + 12
    a = math.floor(y1 / 100)
    b = 2 - a + math.floor(a / 4)
    return (
        math.floor(365.25 * (y1 + 4716))
        + math.floor(30.6001 * (m1 + 1))
        + day
        + hour / 24.0
        + b
        - 1524.5
    )


def jd_to_calendar_utc(jd: float) -> CalendarUTC:
    z = math.floor(jd + 0.5)
    f = jd + 0.5 - z
    a = z
    if z >= 2299161:
        alpha = math.floor((z - 1867216.25) / 36524.25)
        a = z + 1 + alpha - math.floor(alpha / 4)
    b = a + 1524
    c = math.floor((b - 122.1) / 365.25)
    d = math.floor(365.25 * c)
    e = math.floor((b - d) / 30.6001)

    day_float = b - d - math.floor(30.6001 * e) + f
    day = math.floor(day_float)
    hour = (day_float - day) * 24.0
    month = e - 1 if e < 14 else e - 13
    year = c - 4716 if month > 2 else c - 4715

    return CalendarUTC(year=year, month=month, day=day, hour=hour)


MIN_JD = compute_julian_date(1900, 1, 1, 0.0)
MAX_JD = compute_julian_date(2100, 12, 31, 23.9)


def clamp_or_wrap_jd(jd: float) -> float:
    if jd > MAX_JD:
        return MIN_JD + (jd - MAX_JD)
    if jd < MIN_JD:
        return MAX_JD - (MIN_JD - jd)
    return jd


def _skyfield_time_from_jd(jd: float):
    ts, _, _, _ = _get_skyfield_context()
    cal = jd_to_calendar_utc(jd)
    hr = int(math.floor(cal.hour))
    rem_min = (cal.hour - hr) * 60.0
    minute = int(math.floor(rem_min))
    sec = (rem_min - minute) * 60.0
    return ts.utc(cal.year, cal.month, cal.day, hr, minute, sec)


def compute_orbital_mechanics_from_jd(jd: float) -> OrbitalTelemetry:
    _, sun, earth, moon = _get_skyfield_context()
    t = _skyfield_time_from_jd(jd)
    d = jd - 2451545.0

    # High-precision JPL DE440s heliocentric Earth position in ecliptic J2000 frame
    earth_helio = (earth - sun).at(t)
    _, lon_e, dist_e = earth_helio.ecliptic_latlon()
    x_e, y_e, _ = earth_helio.ecliptic_xyz().au
    lambda_e = mod360(lon_e.degrees)
    r_e_au = float(dist_e.au)
    r_e_km = float(dist_e.km)

    # Apparent geocentric Sun longitude
    _, lon_sun, _ = earth.at(t).observe(sun).apparent().ecliptic_latlon()
    lambda_sun = mod360(lon_sun.degrees)

    # High-precision JPL DE440s geocentric Moon position in ecliptic J2000 frame
    moon_geo = (moon - earth).at(t)
    lat_m, lon_m, dist_m = moon_geo.ecliptic_latlon()
    lambda_m = mod360(lon_m.degrees)
    beta_m = float(lat_m.degrees)
    r_m_km = float(dist_m.km)

    # Illuminated fraction from Skyfield apparent geometry
    moon_apparent = earth.at(t).observe(moon).apparent()
    illuminated_fraction = float(moon_apparent.fraction_illuminated(sun))
    elongation = mod360(lambda_m - lambda_sun)

    if 12.0 <= elongation < 78.0:
        phase_name = "Waxing Crescent"
    elif 78.0 <= elongation < 102.0:
        phase_name = "First Quarter"
    elif 102.0 <= elongation < 168.0:
        phase_name = "Waxing Gibbous"
    elif 168.0 <= elongation < 192.0:
        phase_name = "Full Moon"
    elif 192.0 <= elongation < 258.0:
        phase_name = "Waning Gibbous"
    elif 258.0 <= elongation < 282.0:
        phase_name = "Last Quarter"
    elif 282.0 <= elongation < 348.0:
        phase_name = "Waning Crescent"
    else:
        phase_name = "New Moon"

    # GMST from Skyfield (hours -> degrees)
    gmst_deg = mod360(float(t.gmst) * 15.0)

    # Mean orbital anomalies / node for auxiliary telemetry
    m_e = mod360(357.5291 + 0.98560028 * d)
    m_e_rad = m_e * DEG2RAD
    c_e = 1.9148 * math.sin(m_e_rad) + 0.02 * math.sin(2.0 * m_e_rad)
    v_e = mod360(m_e + c_e)
    omega_m = mod360(125.0445 - 0.05295377 * d)

    return OrbitalTelemetry(
        JD=jd,
        d=d,
        M_E=m_e,
        C_E=c_e,
        v_E=v_e,
        lambdaE=lambda_e,
        lambdaSun=lambda_sun,
        rE_AU=r_e_au,
        rE_km=r_e_km,
        xE=float(x_e),
        yE=float(y_e),
        lambdaM=lambda_m,
        betaM=beta_m,
        omegaM=omega_m,
        rM_km=r_m_km,
        elongation=elongation,
        illuminatedFraction=illuminated_fraction,
        phaseName=phase_name,
        GMST_deg=gmst_deg,
        source="NASA/JPL DE440s (Skyfield)",
    )


def compute_trajectory_range(
    start_jd: float, days: float, steps: int
) -> list[dict[str, float]]:
    safe_steps = max(2, min(365, int(steps)))
    points: list[dict[str, float]] = []
    for i in range(safe_steps):
        jd = clamp_or_wrap_jd(start_jd + (days * i) / (safe_steps - 1))
        t = compute_orbital_mechanics_from_jd(jd)
        points.append(
            asdict(
                TrajectoryPoint(
                    JD=t.JD,
                    lambdaE=t.lambdaE,
                    rE_AU=t.rE_AU,
                    lambdaM=t.lambdaM,
                    betaM=t.betaM,
                    rM_km=t.rM_km,
                )
            )
        )
    return points


def _normalize(v: tuple[float, float, float]) -> tuple[float, float, float]:
    norm = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if norm == 0.0:
        return (0.0, 0.0, 0.0)
    return (v[0] / norm, v[1] / norm, v[2] / norm)


def _cross(
    a: tuple[float, float, float], b: tuple[float, float, float]
) -> tuple[float, float, float]:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _dot(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def evaluate_landing_site_viability(
    landing_site: str,
    fecha_iso: str | None = None,
    lat_deg: float | None = None,
    lon_deg: float | None = None,
    site_name: str | None = None,
) -> dict[str, object]:
    preset = CURATED_SITES.get(landing_site)
    name = site_name or (str(preset["name"]) if preset else landing_site)
    lat = lat_deg if lat_deg is not None else (float(preset["lat"]) if preset else -85.0)
    lon = lon_deg if lon_deg is not None else (float(preset["lon"]) if preset else 0.0)

    if fecha_iso:
        dt = datetime.fromisoformat(fecha_iso.replace("Z", "+00:00")).astimezone(timezone.utc)
    else:
        dt = datetime.now(timezone.utc)

    hour_float = dt.hour + dt.minute / 60.0 + dt.second / 3600.0
    jd = clamp_or_wrap_jd(compute_julian_date(dt.year, dt.month, dt.day, hour_float))
    t = compute_orbital_mechanics_from_jd(jd)

    # Ecliptic scene vectors matching frontend Three.js convention
    lon_e_rad = t.lambdaE * DEG2RAD
    v_e_rad = (t.lambdaE - PERIHELION_LON_DEG) * DEG2RAD
    r_e = (16.0 * (1.0 - 0.085 * 0.085)) / (1.0 + 0.085 * math.cos(v_e_rad))
    earth_pos = (r_e * math.cos(lon_e_rad), 0.0, -r_e * math.sin(lon_e_rad))

    r_m = (t.rM_km / 385001.0) * 3.2
    lon_m_rad = t.lambdaM * DEG2RAD
    lat_m_rad = t.betaM * DEG2RAD
    cos_lat_m = math.cos(lat_m_rad)
    moon_offset = (
        r_m * cos_lat_m * math.cos(lon_m_rad),
        r_m * math.sin(lat_m_rad),
        -r_m * cos_lat_m * math.sin(lon_m_rad),
    )
    moon_pos = (
        earth_pos[0] + moon_offset[0],
        earth_pos[1] + moon_offset[1],
        earth_pos[2] + moon_offset[2],
    )

    to_sun = _normalize((-moon_pos[0], -moon_pos[1], -moon_pos[2]))
    z_axis = _normalize(
        (earth_pos[0] - moon_pos[0], earth_pos[1] - moon_pos[1], earth_pos[2] - moon_pos[2])
    )
    x_axis = _normalize(_cross((0.0, 1.0, 0.0), z_axis))
    y_axis = _normalize(_cross(z_axis, x_axis))

    lat_rad = lat * DEG2RAD
    lon_rad = lon * DEG2RAD
    local_normal = _normalize(
        (
            math.cos(lat_rad) * math.sin(lon_rad),
            math.sin(lat_rad),
            math.cos(lat_rad) * math.cos(lon_rad),
        )
    )
    world_normal = _normalize(
        (
            x_axis[0] * local_normal[0] + y_axis[0] * local_normal[1] + z_axis[0] * local_normal[2],
            x_axis[1] * local_normal[0] + y_axis[1] * local_normal[1] + z_axis[1] * local_normal[2],
            x_axis[2] * local_normal[0] + y_axis[2] * local_normal[1] + z_axis[2] * local_normal[2],
        )
    )

    cos_sun = max(-1.0, min(1.0, _dot(world_normal, to_sun)))
    sun_elev_deg = math.asin(cos_sun) * RAD2DEG
    sun_hits = cos_sun > 0.0
    earth_visible = local_normal[2] > 0.0

    # Manual toggle to test steep-slope landing failure (applies only to IM-1 Odysseus for now)
    slope_too_steep = True

    if slope_too_steep and landing_site == "im1-odysseus":
        funciona = False
        tipo_despegue = "Not viable (unsafe terrain)"
        tipo_fallo = "Terrain slope too steep"
    elif sun_hits and earth_visible:
        funciona = True
        tipo_despegue = f"Viable (solar elevation +{sun_elev_deg:.1f}°, direct Earth link)"
        tipo_fallo = "None"
    elif sun_hits and not earth_visible:
        funciona = False
        tipo_despegue = f"Partial (solar elevation +{sun_elev_deg:.1f}°, relay required)"
        tipo_fallo = "No direct line of sight to Earth"
    elif not sun_hits and earth_visible:
        funciona = False
        tipo_despegue = "Not viable (wait for lunar sunrise)"
        tipo_fallo = f"No solar illumination ({sun_elev_deg:.1f}°)"
    else:
        funciona = False
        tipo_despegue = "Not viable"
        tipo_fallo = f"No solar illumination ({sun_elev_deg:.1f}°) and no direct Earth link"

    return {
        "name": name,
        "funciona": funciona,
        "tipo_despegue": tipo_despegue,
        "tipo_fallo": tipo_fallo,
    }
