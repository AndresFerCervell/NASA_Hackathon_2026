import * as THREE from 'three';
import {
  computeOrbitalMechanicsFromJD,
  DEG2RAD,
  getEarthScenePosition,
  getMoonRelativeScenePosition,
  RAD2DEG,
} from './ephemeris';

export interface MissionDateUTC {
  year: number;
  month: number;
  day: number;
  hour: number;
}

export interface LandingSite {
  id: string;
  name: string;
  program: string;
  region: string;
  pole: 'north' | 'south' | 'equatorial';
  latDeg: number;
  lonDeg: number;
  missionDate?: MissionDateUTC;
  dateLabel?: string;
  featured?: boolean;
  isCustom?: boolean;
}

export interface SolarImpactStatus {
  sunHits: boolean;
  elevationDeg: number;
  cosIncidence: number;
  earthVisible: boolean;
  earthElevationDeg: number;
}

/**
 * Curated lunar landing sites with official selenographic coordinates and mission dates.
 */
export const CURATED_LANDING_SITES: LandingSite[] = [
  {
    id: 'artemis3-shackleton',
    name: 'Artemis III (Shackleton Rim)',
    program: 'Artemis III',
    region: 'South Pole · Peak Near Shackleton',
    pole: 'south',
    latDeg: -89.68,
    lonDeg: 129.0,
    missionDate: { year: 2026, month: 11, day: 14, hour: 10.67 },
    dateLabel: '2026-11-14 10:40 UTC',
    featured: true,
  },
  {
    id: 'apollo-11',
    name: 'Apollo 11 (Tranquility Base)',
    program: 'Apollo',
    region: 'Mare Tranquillitatis',
    pole: 'equatorial',
    latDeg: 0.67,
    lonDeg: 23.47,
    missionDate: { year: 1969, month: 7, day: 20, hour: 20.29 },
    dateLabel: '1969-07-20 20:17 UTC',
    featured: true,
  },
  {
    id: 'south-pole-slope-test',
    name: 'South Pole Ridge',
    program: 'Artemis · Candidate',
    region: 'South Pole · 89.7° S, 0° E',
    pole: 'south',
    latDeg: -89.7,
    lonDeg: 0.0,
    missionDate: { year: 2026, month: 11, day: 14, hour: 10.67 },
    dateLabel: '2026-11-14 10:40 UTC',
  },
  {
    id: 'shackleton-steep-slope',
    name: 'Shackleton Wall',
    program: 'Artemis · Candidate',
    region: 'South Pole · Shackleton Crater',
    pole: 'south',
    latDeg: -89.8,
    lonDeg: 90.0,
    missionDate: { year: 2026, month: 11, day: 14, hour: 10.67 },
    dateLabel: '2026-11-14 10:40 UTC',
  },
  {
    id: 'de-gerlache-crater',
    name: 'De Gerlache Crater',
    program: 'South Pole · Crater',
    region: 'South Pole · De Gerlache',
    pole: 'south',
    latDeg: -88.48,
    lonDeg: -88.34,
    missionDate: { year: 2026, month: 11, day: 14, hour: 10.67 },
    dateLabel: '2026-11-14 10:40 UTC',
  },
  {
    id: 'faustini-crater',
    name: 'Faustini Crater',
    program: 'South Pole · Crater',
    region: 'South Pole · Faustini',
    pole: 'south',
    latDeg: -87.18,
    lonDeg: 84.31,
    missionDate: { year: 2026, month: 11, day: 14, hour: 10.67 },
    dateLabel: '2026-11-14 10:40 UTC',
  },
  {
    id: 'cabeus-crater',
    name: 'Cabeus Crater',
    program: 'South Pole · Crater',
    region: 'South Pole · Cabeus',
    pole: 'south',
    latDeg: -85.33,
    lonDeg: -42.13,
    missionDate: { year: 2026, month: 11, day: 14, hour: 10.67 },
    dateLabel: '2026-11-14 10:40 UTC',
  },
  {
    id: 'oceanus-procellarum',
    name: 'Oceanus Procellarum',
    program: 'Near Side · Mare',
    region: 'Western Near Side',
    pole: 'north',
    latDeg: 18.0,
    lonDeg: -45.0,
    missionDate: { year: 2026, month: 11, day: 14, hour: 10.67 },
    dateLabel: '2026-11-14 10:40 UTC',
  },
  {
    id: 'mare-imbrium',
    name: 'Mare Imbrium',
    program: 'Near Side · Mare',
    region: 'Northwestern Near Side',
    pole: 'north',
    latDeg: 35.0,
    lonDeg: -15.0,
    missionDate: { year: 2026, month: 11, day: 14, hour: 10.67 },
    dateLabel: '2026-11-14 10:40 UTC',
  },
  {
    id: 'mare-serenitatis',
    name: 'Mare Serenitatis',
    program: 'Near Side · Mare',
    region: 'Northeastern Near Side',
    pole: 'north',
    latDeg: 28.0,
    lonDeg: 17.0,
    missionDate: { year: 2026, month: 11, day: 14, hour: 10.67 },
    dateLabel: '2026-11-14 10:40 UTC',
  },
  {
    id: 'von-karman',
    name: 'Von Kármán (Far Side)',
    program: 'Far Side · Crater',
    region: 'South Pole–Aitken Basin',
    pole: 'equatorial',
    latDeg: -45.45,
    lonDeg: 177.6,
    missionDate: { year: 2026, month: 11, day: 14, hour: 10.67 },
    dateLabel: '2026-11-14 10:40 UTC',
  },
  {
    id: 'mare-moscoviense',
    name: 'Mare Moscoviense (Far Side)',
    program: 'Far Side · Mare',
    region: 'Northern Far Side',
    pole: 'north',
    latDeg: 27.3,
    lonDeg: 147.9,
    missionDate: { year: 2026, month: 11, day: 14, hour: 10.67 },
    dateLabel: '2026-11-14 10:40 UTC',
  },
];

/**
 * Selenographic spherical -> local 3D point (+Z faces Earth at lat=0, lon=0; +Y is North).
 */
export function geoPoint(latDeg: number, lonDeg: number, radius = 1.731): THREE.Vector3 {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.sin(lon),
    radius * Math.sin(lat),
    radius * Math.cos(lat) * Math.cos(lon)
  );
}

export function formatDms(value: number, isLatitude: boolean): string {
  const hemi = isLatitude ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const absolute = Math.abs(value);
  let degrees = Math.floor(absolute);
  let minutes = Math.round((absolute - degrees) * 60);
  if (minutes === 60) {
    degrees += 1;
    minutes = 0;
  }
  return `${degrees}° ${String(minutes).padStart(2, '0')}′ ${hemi}`;
}

export function getQuickmapUrl(latDeg: number, lonDeg: number): string {
  return `https://quickmap.lroc.asu.edu/?extent=${(lonDeg - 2).toFixed(2)},${(latDeg - 2).toFixed(2)},${(lonDeg + 2).toFixed(2)},${(latDeg + 2).toFixed(2)}&proj=10`;
}

/**
 * Computes whether sunlight hits a selenographic site at Julian Date `jd`,
 * plus line-of-sight Earth visibility for direct-to-Earth communications.
 */
export function computeSiteSolarImpact(site: LandingSite, jd: number): SolarImpactStatus {
  const t = computeOrbitalMechanicsFromJD(jd);
  const [ex, ey, ez] = getEarthScenePosition(t.lambdaE);
  const [mx, my, mz] = getMoonRelativeScenePosition(t.lambdaM, t.betaM, t.rM_km);

  const earthPos = new THREE.Vector3(ex, ey, ez);
  const moonPos = new THREE.Vector3(ex + mx, ey + my, ez + mz);

  // Direction from Moon to Sun (Sun is at origin [0, 0, 0])
  const toSun = moonPos.clone().negate().normalize();

  // Moon local frame: +Z points toward Earth (tidally locked), +Y up
  const zAxis = earthPos.clone().sub(moonPos).normalize();
  const upRef = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3().crossVectors(upRef, zAxis).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

  const localNormal = geoPoint(site.latDeg, site.lonDeg, 1).normalize();
  const worldNormal = new THREE.Vector3()
    .addScaledVector(xAxis, localNormal.x)
    .addScaledVector(yAxis, localNormal.y)
    .addScaledVector(zAxis, localNormal.z)
    .normalize();

  const cosIncidence = THREE.MathUtils.clamp(worldNormal.dot(toSun), -1, 1);
  const elevationDeg = Math.asin(cosIncidence) * RAD2DEG;

  // Earth is along local +Z (sub-Earth point lat=0, lon=0)
  const cosEarth = THREE.MathUtils.clamp(localNormal.z, -1, 1);
  const earthElevationDeg = Math.asin(cosEarth) * RAD2DEG;

  return {
    sunHits: cosIncidence > 0,
    elevationDeg,
    cosIncidence,
    earthVisible: cosEarth > 0,
    earthElevationDeg,
  };
}
