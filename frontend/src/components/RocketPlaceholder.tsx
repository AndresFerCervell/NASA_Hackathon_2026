import { useEffect, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  computeOrbitalMechanicsFromJD,
  getEarthScenePosition,
  getMoonRelativeScenePosition,
} from '../astronomy/ephemeris';
import { geoPoint, type LandingSite } from '../astronomy/landingSites';
import type { StellarData } from '../model/datosEstelares';

interface RocketPlaceholderProps {
  isPlaying: boolean;
  missionRunId: number;
  stellarData: StellarData | null;
  selectedSite: LandingSite | null;
  jdRef: MutableRefObject<number>;
  baseOrbitR: number;
  visEcc: number;
  baseMoonR: number;
}

export type FailureMode = 'none' | 'comms' | 'solar' | 'critical';

export function getFailureMode(
  stellarData: StellarData | null,
  fallbackImpact?: { sunHits: boolean; earthVisible: boolean } | null
): FailureMode {
  if (!stellarData) {
    if (!fallbackImpact) return 'none';
    if (!fallbackImpact.sunHits && !fallbackImpact.earthVisible) return 'critical';
    if (!fallbackImpact.earthVisible) return 'comms';
    if (!fallbackImpact.sunHits) return 'solar';
    return 'none';
  }
  if (stellarData.funciona) return 'none';
  const fallo = stellarData.tipo_fallo.toLowerCase();
  const noSun =
    fallo.includes('solar illumination') ||
    fallo.includes('iluminación solar') ||
    fallo.includes('luz solar');
  const noComms =
    fallo.includes('line of sight') ||
    fallo.includes('earth link') ||
    fallo.includes('línea de visión') ||
    fallo.includes('enlace directo');
  if (noSun && noComms) return 'critical';
  if (noComms) return 'comms';
  if (noSun) return 'solar';
  return 'critical';
}

export function RocketPlaceholder({
  isPlaying,
  missionRunId,
  stellarData,
  selectedSite,
  jdRef,
  baseOrbitR,
  visEcc,
  baseMoonR,
}: RocketPlaceholderProps) {
  const rocketRef = useRef<THREE.Group | null>(null);
  const flameRef = useRef<THREE.Mesh | null>(null);
  const beaconRef = useRef<THREE.Mesh | null>(null);
  const progressRef = useRef(0);

  // Reset flight progress whenever a new simulation run starts
  useEffect(() => {
    progressRef.current = 0;
  }, [missionRunId]);

  const failureMode = getFailureMode(stellarData);

  useFrame((_, delta) => {
    if (!rocketRef.current || !selectedSite) return;

    const dt = Math.min(0.05, delta);
    if (isPlaying) {
      progressRef.current = Math.min(1, progressRef.current + dt / 4.5);
    }

    const p = progressRef.current;
    const t = computeOrbitalMechanicsFromJD(jdRef.current);
    const [ex, ey, ez] = getEarthScenePosition(t.lambdaE, baseOrbitR, visEcc);
    const [mx, my, mz] = getMoonRelativeScenePosition(
      t.lambdaM,
      t.betaM,
      t.rM_km,
      baseMoonR
    );

    const earthPos = new THREE.Vector3(ex, ey, ez);
    const moonPos = new THREE.Vector3(ex + mx, ey + my, ez + mz);

    // Compute world normal of selected landing site on Moon
    const zAxis = earthPos.clone().sub(moonPos).normalize();
    const xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zAxis).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

    const localNormal = geoPoint(selectedSite.latDeg, selectedSite.lonDeg, 1).normalize();
    const siteWorldNormal = new THREE.Vector3()
      .addScaledVector(xAxis, localNormal.x)
      .addScaledVector(yAxis, localNormal.y)
      .addScaledVector(zAxis, localNormal.z)
      .normalize();

    const startPos = earthPos.clone().add(zAxis.clone().negate().multiplyScalar(0.95));
    const approachPos = moonPos.clone().add(siteWorldNormal.clone().multiplyScalar(0.75));
    const touchdownPos = moonPos.clone().add(siteWorldNormal.clone().multiplyScalar(0.32));

    const currentPos = new THREE.Vector3();

    if (failureMode === 'none') {
      // Successful trajectory & upright soft landing
      if (p < 0.72) {
        const u = p / 0.72;
        const arcHeight = Math.sin(u * Math.PI) * 0.8;
        currentPos.lerpVectors(startPos, approachPos, u);
        currentPos.y += arcHeight;

        const nextU = Math.min(1, u + 0.02);
        const nextPos = new THREE.Vector3().lerpVectors(startPos, approachPos, nextU);
        nextPos.y += Math.sin(nextU * Math.PI) * 0.8;
        rocketRef.current.position.copy(currentPos);
        rocketRef.current.lookAt(nextPos);
        rocketRef.current.rotateX(Math.PI / 2);
      } else {
        // Final descent: upright orientation (nose pointing outward along siteWorldNormal)
        const u = (p - 0.72) / 0.28;
        const eased = 1 - Math.pow(1 - u, 2);
        currentPos.lerpVectors(approachPos, touchdownPos, eased);
        rocketRef.current.position.copy(currentPos);
        const upQuat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          siteWorldNormal
        );
        rocketRef.current.quaternion.copy(upQuat);
      }

      if (flameRef.current) {
        flameRef.current.visible = isPlaying && p < 0.98;
        const flicker = 0.85 + Math.sin(p * 80) * 0.15;
        flameRef.current.scale.set(1, flicker, 1);
      }
      if (beaconRef.current) {
        beaconRef.current.visible = p >= 0.96;
        beaconRef.current.position.copy(touchdownPos);
      }
    } else {
      // Failure trajectories based on tipo_fallo
      const abortPoint = failureMode === 'critical' ? 0.45 : failureMode === 'comms' ? 0.65 : 0.78;

      if (p < abortPoint) {
        const u = p / abortPoint;
        currentPos.lerpVectors(startPos, approachPos, u * abortPoint);
        currentPos.y += Math.sin(u * Math.PI) * 0.6;
        rocketRef.current.position.copy(currentPos);
        rocketRef.current.lookAt(approachPos);
        rocketRef.current.rotateX(Math.PI / 2);
      } else {
        const u = (p - abortPoint) / (1 - abortPoint);
        const baseAbortPos = new THREE.Vector3().lerpVectors(startPos, approachPos, abortPoint);
        const driftDir =
          failureMode === 'comms'
            ? xAxis.clone().multiplyScalar(1.8)
            : failureMode === 'solar'
              ? yAxis.clone().multiplyScalar(-1.5)
              : xAxis.clone().add(yAxis).normalize().multiplyScalar(2.0);
        currentPos.copy(baseAbortPos).addScaledVector(driftDir, u);
        rocketRef.current.position.copy(currentPos);
        // Tumble on failure
        rocketRef.current.rotation.x += dt * 4.5;
        rocketRef.current.rotation.z += dt * 3.2;
      }

      if (flameRef.current) {
        flameRef.current.visible = isPlaying && p < abortPoint;
      }
      if (beaconRef.current) {
        beaconRef.current.visible = p >= abortPoint;
        beaconRef.current.position.copy(currentPos);
      }
    }
  });

  if (!selectedSite) return null;

  const isFailed = failureMode !== 'none';
  const bodyColor = isFailed ? '#fca5a5' : '#e2e8f0';
  const accentColor = isFailed ? '#ef4444' : '#38bdf8';

  return (
    <>
      <group ref={rocketRef}>
        {/* Rocket Body */}
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[0.045, 0.055, 0.22, 12]} />
          <meshStandardMaterial color={bodyColor} metalness={0.4} roughness={0.4} />
        </mesh>
        {/* Nosecone */}
        <mesh position={[0, 0.15, 0]}>
          <coneGeometry args={[0.045, 0.09, 12]} />
          <meshStandardMaterial color={accentColor} metalness={0.3} roughness={0.4} />
        </mesh>
        {/* Fins */}
        <mesh position={[0.055, -0.075, 0]}>
          <boxGeometry args={[0.04, 0.06, 0.012]} />
          <meshStandardMaterial color={accentColor} />
        </mesh>
        <mesh position={[-0.055, -0.075, 0]}>
          <boxGeometry args={[0.04, 0.06, 0.012]} />
          <meshStandardMaterial color={accentColor} />
        </mesh>
        {/* Thruster Flame */}
        <mesh ref={flameRef} position={[0, -0.16, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.036, 0.12, 10]} />
          <meshBasicMaterial color={isFailed ? '#f97316' : '#fbbf24'} />
        </mesh>
      </group>

      {/* Landing / Abort Status Beacon */}
      <mesh ref={beaconRef} visible={false}>
        <sphereGeometry args={[0.09, 16, 16]} />
        <meshBasicMaterial
          color={isFailed ? '#ef4444' : '#22c55e'}
          transparent
          opacity={0.75}
        />
      </mesh>
    </>
  );
}
