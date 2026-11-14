import * as THREE from 'three';
import {
  computeOrbitalMechanicsFromJD,
  DEG2RAD,
  getEarthScenePosition,
  getMoonRelativeScenePosition,
  RAD2DEG,
} from './ephemeris';

export interface LandingSite {
  id: string;
  name: string;
  pole: 'north' | 'south';
  latDeg: number;
  lonDeg: number;
}

export interface SolarImpactStatus {
  sunHits: boolean;
  elevationDeg: number;
  cosIncidence: number;
}

/**
 * Selenographic spherical -> local 3D point (+Z faces Earth at lat=0, lon=0; +Y is North).
 */
export function geoPoint(latDeg: number, lonDeg: number, radius = 1.731): THREE.Vector3 {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  return new THREE.Vector3(
    -radius * Math.cos(lat) * Math.sin(lon),
    radius * Math.sin(lat),
    radius * Math.cos(lat) * Math.cos(lon)
  );
}

export function formatDms(value: number, isLatitude: boolean): string {
  const hemi = isLatitude ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'O';
  const absolute = Math.abs(value);
  let degrees = Math.floor(absolute);
  let minutes = Math.round((absolute - degrees) * 60);
  if (minutes === 60) {
    degrees += 1;
    minutes = 0;
  }
  return `${degrees}° ${String(minutes).padStart(2, '0')}′ ${hemi}`;
}

export function generateRandomLandingSites(): LandingSite[] {
  const southLon1 = Math.round((Math.random() * 360 - 180) * 10) / 10;
  // Offset second south pole site by 100-220 deg so the two pins are clearly separated
  const offset = 100 + Math.random() * 120;
  const rawLon2 = ((southLon1 + offset + 180) % 360) - 180;
  const southLon2 = Math.round(rawLon2 * 10) / 10;
  const northLon = Math.round((Math.random() * 360 - 180) * 10) / 10;

  return [
    {
      id: 'south-1',
      name: 'Sitio Sur 1',
      pole: 'south',
      latDeg: Math.round((-80.5 - Math.random() * 7.5) * 10) / 10,
      lonDeg: southLon1,
    },
    {
      id: 'south-2',
      name: 'Sitio Sur 2',
      pole: 'south',
      latDeg: Math.round((-80.5 - Math.random() * 7.5) * 10) / 10,
      lonDeg: southLon2,
    },
    {
      id: 'north-1',
      name: 'Sitio Norte',
      pole: 'north',
      latDeg: Math.round((80.5 + Math.random() * 7.5) * 10) / 10,
      lonDeg: northLon,
    },
  ];
}

/**
 * Computes whether sunlight hits a selenographic site at Julian Date `jd`.
 * Uses the Moon's tidally-locked Earth-facing frame (+Z -> Earth, +Y -> ecliptic north).
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

  return {
    sunHits: cosIncidence > 0,
    elevationDeg,
    cosIncidence,
  };
}
