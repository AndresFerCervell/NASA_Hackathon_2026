export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const AU_KM = 149_597_870.7;
export const PERIHELION_LON_DEG = 102.9373;
export const EARTH_OBLIQUITY_DEG = 23.4393;
export const MOON_INCLINATION_DEG = 5.145;

export interface CalendarUTC {
  year: number;
  month: number;
  day: number;
  hour: number;
}

export interface OrbitalTelemetry {
  JD: number;
  d: number;
  M_E: number;
  C_E: number;
  v_E: number;
  lambdaE: number;
  lambdaSun: number;
  rE_AU: number;
  rE_km: number;
  xE: number;
  yE: number;
  lambdaM: number;
  betaM: number;
  omegaM: number;
  rM_km: number;
  elongation: number;
  illuminatedFraction: number;
  phaseName: string;
  GMST_deg: number;
}

export function mod360(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function computeJulianDate(Y: number, M: number, D: number, H: number): number {
  let Y1 = Y;
  let M1 = M;
  if (M <= 2) {
    Y1 = Y - 1;
    M1 = M + 12;
  }
  const A = Math.floor(Y1 / 100);
  const B = 2 - A + Math.floor(A / 4);
  return (
    Math.floor(365.25 * (Y1 + 4716)) +
    Math.floor(30.6001 * (M1 + 1)) +
    D +
    H / 24 +
    B -
    1524.5
  );
}

export function jdToCalendarUTC(jd: number): CalendarUTC {
  const Z = Math.floor(jd + 0.5);
  const F = jd + 0.5 - Z;
  let A = Z;
  if (Z >= 2299161) {
    const alpha = Math.floor((Z - 1867216.25) / 36524.25);
    A = Z + 1 + alpha - Math.floor(alpha / 4);
  }
  const B = A + 1524;
  const C = Math.floor((B - 122.1) / 365.25);
  const D = Math.floor(365.25 * C);
  const E = Math.floor((B - D) / 30.6001);

  const dayFloat = B - D - Math.floor(30.6001 * E) + F;
  const day = Math.floor(dayFloat);
  const hour = (dayFloat - day) * 24;
  const month = E < 14 ? E - 1 : E - 13;
  const year = month > 2 ? C - 4716 : C - 4715;

  return { year, month, day, hour };
}

export const MIN_JD = computeJulianDate(1900, 1, 1, 0);
export const MAX_JD = computeJulianDate(2100, 12, 31, 23.9);

export function clampOrWrapJD(jd: number): number {
  if (jd > MAX_JD) return MIN_JD + (jd - MAX_JD);
  if (jd < MIN_JD) return MAX_JD - (MIN_JD - jd);
  return jd;
}

export function computeOrbitalMechanicsFromJD(JD: number): OrbitalTelemetry {
  const d = JD - 2451545.0;

  // 1. Earth Heliocentric Coordinates
  const M_E = mod360(357.5291 + 0.98560028 * d);
  const M_E_rad = M_E * DEG2RAD;
  const C_E = 1.9148 * Math.sin(M_E_rad) + 0.02 * Math.sin(2 * M_E_rad);
  const v_E = mod360(M_E + C_E);
  const v_E_rad = v_E * DEG2RAD;
  const lambdaE = mod360(v_E + PERIHELION_LON_DEG);
  const e_E = 0.0167086;
  const rE_AU = (1.000001018 * (1 - e_E * e_E)) / (1 + e_E * Math.cos(v_E_rad));
  const rE_km = rE_AU * AU_KM;
  const xE = rE_AU * Math.cos(lambdaE * DEG2RAD);
  const yE = rE_AU * Math.sin(lambdaE * DEG2RAD);

  // Apparent Geocentric Sun Longitude
  const lambdaSun = mod360(lambdaE + 180);

  // 2. Moon Geocentric Coordinates
  const L_M = mod360(218.3165 + 13.17639648 * d);
  const M_M = mod360(134.9634 + 13.06499295 * d);
  const D_M = mod360(297.8502 + 12.19074912 * d);
  const F_M = mod360(93.2719 + 13.22935024 * d);
  const omegaM = mod360(125.0445 - 0.05295377 * d);

  const M_M_rad = M_M * DEG2RAD;
  const D_M_rad = D_M * DEG2RAD;
  const F_M_rad = F_M * DEG2RAD;

  const lambdaM = mod360(
    L_M +
      6.2888 * Math.sin(M_M_rad) +
      1.274 * Math.sin(2 * D_M_rad - M_M_rad) +
      0.6583 * Math.sin(2 * D_M_rad) -
      0.1856 * Math.sin(M_E_rad)
  );

  // Ecliptic latitude for 3D orbital inclination (~5.145 deg)
  const betaM = 5.128 * Math.sin(F_M_rad);

  const rM_km =
    385001 -
    20905 * Math.cos(M_M_rad) -
    3699 * Math.cos(2 * D_M_rad - M_M_rad) -
    2956 * Math.cos(2 * D_M_rad);

  // 3. Lunar Phase & Elongation
  const elongation = mod360(lambdaM - lambdaSun);
  const illuminatedFraction = (1 - Math.cos(elongation * DEG2RAD)) / 2;

  let phaseName = 'New Moon';
  if (elongation >= 12 && elongation < 78) phaseName = 'Waxing Crescent';
  else if (elongation >= 78 && elongation < 102) phaseName = 'First Quarter';
  else if (elongation >= 102 && elongation < 168) phaseName = 'Waxing Gibbous';
  else if (elongation >= 168 && elongation < 192) phaseName = 'Full Moon';
  else if (elongation >= 192 && elongation < 258) phaseName = 'Waning Gibbous';
  else if (elongation >= 258 && elongation < 282) phaseName = 'Last Quarter';
  else if (elongation >= 282 && elongation < 348) phaseName = 'Waning Crescent';

  // 4. Earth Sidereal Spin (GMST)
  const GMST_deg = mod360(280.46061837 + 360.98564736629 * d);

  return {
    JD,
    d,
    M_E,
    C_E,
    v_E,
    lambdaE,
    lambdaSun,
    rE_AU,
    rE_km,
    xE,
    yE,
    lambdaM,
    betaM,
    omegaM,
    rM_km,
    elongation,
    illuminatedFraction,
    phaseName,
    GMST_deg,
  };
}

export function formatUTCString(Y: number, M: number, D: number, H: number): string {
  const pad2 = (n: number) => String(Math.floor(n)).padStart(2, '0');
  const hrs = Math.floor(H);
  const mins = Math.min(59, Math.round((H - hrs) * 60));
  return `${Y}-${pad2(M)}-${pad2(D)} ${pad2(hrs)}:${pad2(mins)} UTC`;
}

/**
 * Maps ecliptic longitude (deg) and optional visual eccentricity into Three.js XZ plane
 * (+X = 0° Aries, -Z = 90° Cancer, +Y = North Ecliptic Pole -> counter-clockwise from +Y).
 */
export function getEarthScenePosition(
  lambdaEDeg: number,
  baseOrbitRadius = 16,
  visualEccentricity = 0.085
): [number, number, number] {
  const lonRad = lambdaEDeg * DEG2RAD;
  const vRad = lonRad - PERIHELION_LON_DEG * DEG2RAD;
  const r =
    (baseOrbitRadius * (1 - visualEccentricity * visualEccentricity)) /
    (1 + visualEccentricity * Math.cos(vRad));
  return [r * Math.cos(lonRad), 0, -r * Math.sin(lonRad)];
}

/**
 * Maps Moon's geocentric ecliptic coordinates (lambdaM, betaM, rM_km)
 * into a 3D offset vector relative to Earth in Three.js space.
 */
export function getMoonRelativeScenePosition(
  lambdaMDeg: number,
  betaMDeg: number,
  rM_km: number,
  baseMoonOrbitRadius = 3.2
): [number, number, number] {
  const r = (rM_km / 385001) * baseMoonOrbitRadius;
  const lonRad = lambdaMDeg * DEG2RAD;
  const latRad = betaMDeg * DEG2RAD;
  const cosLat = Math.cos(latRad);
  return [
    r * cosLat * Math.cos(lonRad),
    r * Math.sin(latRad),
    -r * cosLat * Math.sin(lonRad),
  ];
}
