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
 * Curated NASA landing sites with official selenographic coordinates and mission dates.
 */
export const CURATED_LANDING_SITES: LandingSite[] = [
  {
    id: 'im1-odysseus',
    name: 'IM-1 Odysseus (Malapert A)',
    program: 'NASA CLPS',
    region: 'South Pole · Malapert A',
    pole: 'south',
    latDeg: -80.13,
    lonDeg: 1.44,
    missionDate: { year: 2024, month: 2, day: 22, hour: 23.38 },
    dateLabel: '2024-02-22 23:23 UTC',
  },
  {
    id: 'artemis3-shackleton',
    name: 'Artemis III (Shackleton Rim)',
    program: 'NASA Artemis III',
    region: 'South Pole · Peak Near Shackleton',
    pole: 'south',
    latDeg: -89.68,
    lonDeg: 129.0,
    missionDate: { year: 2026, month: 11, day: 14, hour: 10.67 },
    dateLabel: '2026-11-14 10:40 UTC',
  },
  {
    id: 'apollo-11',
    name: 'Apollo 11 (Tranquility Base)',
    program: 'NASA Apollo',
    region: 'Mare Tranquillitatis',
    pole: 'equatorial',
    latDeg: 0.67,
    lonDeg: 23.47,
    missionDate: { year: 1969, month: 7, day: 20, hour: 20.29 },
    dateLabel: '1969-07-20 20:17 UTC',
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
