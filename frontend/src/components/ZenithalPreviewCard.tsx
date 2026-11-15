import { useMemo, useRef, type MutableRefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import {
  computeOrbitalMechanicsFromJD,
  DEG2RAD,
  getEarthScenePosition,
  getMoonRelativeScenePosition,
  MOON_INCLINATION_DEG,
} from '../astronomy/ephemeris';
import type { CameraMode } from './SolarSystemScene';

interface ZenithalPreviewCardProps {
  jdRef: MutableRefObject<number>;
  cameraMode: CameraMode;
  onFocusZenithal: () => void;
}

const BASE_ORBIT_R = 16;
const VIS_ECC = 0.085;
const BASE_MOON_R = 3.2;

function ZenithalMiniScene({ jdRef }: { jdRef: MutableRefObject<number> }) {
  const earthGroupRef = useRef<THREE.Group | null>(null);
  const moonMeshRef = useRef<THREE.Mesh | null>(null);
  const moonRingRef = useRef<THREE.Group | null>(null);

  const earthOrbitPoints = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let deg = 0; deg <= 360; deg += 4) {
      pts.push(getEarthScenePosition(deg, BASE_ORBIT_R, VIS_ECC));
    }
    return pts;
  }, []);

  const moonOrbitPoints = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let deg = 0; deg <= 360; deg += 10) {
      const r = deg * DEG2RAD;
      pts.push([Math.cos(r) * BASE_MOON_R, 0, -Math.sin(r) * BASE_MOON_R]);
    }
    return pts;
  }, []);

  useFrame(() => {
    const t = computeOrbitalMechanicsFromJD(jdRef.current);
    const [ex, ey, ez] = getEarthScenePosition(t.lambdaE, BASE_ORBIT_R, VIS_ECC);
    if (earthGroupRef.current) {
      earthGroupRef.current.position.set(ex, ey, ez);
    }

    const [mx, my, mz] = getMoonRelativeScenePosition(
      t.lambdaM,
      t.betaM,
      t.rM_km,
      BASE_MOON_R
    );
    if (moonMeshRef.current) {
      moonMeshRef.current.position.set(mx, my, mz);
    }
    if (moonRingRef.current) {
      moonRingRef.current.rotation.set(0, 0, 0);
      moonRingRef.current.rotateY(t.omegaM * DEG2RAD);
      moonRingRef.current.rotateX(MOON_INCLINATION_DEG * DEG2RAD);
    }
  });

  return (
    <>
      <ambientLight intensity={1.2} />
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[1.3, 20, 20]} />
        <meshBasicMaterial color="#fbbf24" />
      </mesh>

      <Line points={earthOrbitPoints} color="#38bdf8" lineWidth={1} transparent opacity={0.35} />

      <group ref={earthGroupRef}>
        <mesh>
          <sphereGeometry args={[0.72, 18, 18]} />
          <meshBasicMaterial color="#38bdf8" />
        </mesh>

        <group ref={moonRingRef}>
          <Line points={moonOrbitPoints} color="#94a3b8" lineWidth={1} transparent opacity={0.45} />
        </group>

        <mesh ref={moonMeshRef}>
          <sphereGeometry args={[0.38, 14, 14]} />
          <meshBasicMaterial color="#e2e8f0" />
        </mesh>
      </group>
    </>
  );
}

export function ZenithalPreviewCard({
  jdRef,
  cameraMode,
  onFocusZenithal,
}: ZenithalPreviewCardProps) {
  return (
    <aside className="hud-card zenithal-preview-card" aria-label="Zenithal orbit preview">
      <div className="zenithal-preview-head">
        <span className="sim-advanced-heading">Zenithal Preview</span>
        <button
          type="button"
          className={`hud-btn zenithal-focus-btn ${cameraMode === 'zenithal' ? 'is-active' : ''}`}
          onClick={onFocusZenithal}
          title="Switch main camera to Zenithal view"
        >
          {cameraMode === 'zenithal' ? 'Active' : 'Focus ↗'}
        </button>
      </div>
      <div className="zenithal-canvas-wrap">
        <Canvas
          camera={{ position: [0, 44, 0.01], fov: 44, near: 0.1, far: 150 }}
          dpr={1}
          gl={{ antialias: true, powerPreference: 'low-power' }}
        >
          <color attach="background" args={['#020617']} />
          <ZenithalMiniScene jdRef={jdRef} />
        </Canvas>
      </div>
    </aside>
  );
}
