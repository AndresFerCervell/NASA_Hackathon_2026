import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard, Line, OrbitControls, Stars, Text, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  clampOrWrapJD,
  computeOrbitalMechanicsFromJD,
  DEG2RAD,
  EARTH_OBLIQUITY_DEG,
  getEarthScenePosition,
  getMoonRelativeScenePosition,
  MOON_INCLINATION_DEG,
  PERIHELION_LON_DEG,
} from '../astronomy/ephemeris';
import { createSunGlowTexture } from '../astronomy/textures';
import type { LandingSite } from '../astronomy/landingSites';
import type { StellarData } from '../model/datosEstelares';
import { RocketPlaceholder } from './RocketPlaceholder';

export type CameraMode = 'heliocentric' | 'zenithal' | 'geocentric';

interface SolarSystemSceneProps {
  jdRef: MutableRefObject<number>;
  isPlaying: boolean;
  speedHoursPerSec: number;
  cameraMode: CameraMode;
  showLabels: boolean;
  onTelemetrySample: (jd: number) => void;
  stellarData: StellarData | null;
  selectedSite: LandingSite | null;
  missionRunId: number;
  onReady?: () => void;
}

const BASE_ORBIT_R = 16;
const VIS_ECC = 0.085;
const BASE_MOON_R = 3.2;

export function SolarSystemScene({
  jdRef,
  isPlaying,
  speedHoursPerSec,
  cameraMode,
  showLabels,
  onTelemetrySample,
  stellarData,
  selectedSite,
  missionRunId,
  onReady,
}: SolarSystemSceneProps) {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const readyCalledRef = useRef(false);

  const earthSystemRef = useRef<THREE.Group | null>(null);
  const earthSpinRef = useRef<THREE.Group | null>(null);
  const moonRef = useRef<THREE.Mesh | null>(null);
  const moonOrbitRingRef = useRef<THREE.Group | null>(null);

  const lastEarthPosRef = useRef(new THREE.Vector3(...getEarthScenePosition(0, BASE_ORBIT_R, VIS_ECC)));
  const lastUiSyncTimeRef = useRef(0);

  // Shared cached textures via Drei useTexture (do not dispose cache-owned entries)
  const { earthMap, moonMap, sunMap, starfieldMap } = useTexture({
    earthMap: '/textures/earth.jpg',
    moonMap: '/textures/moon.jpg',
    sunMap: '/textures/sun.jpg',
    starfieldMap: '/textures/stars_milky_way.jpg',
  });
  const sunGlowTexture = useMemo(() => createSunGlowTexture(), []);

  const earthAtmosphereMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color('#5bb4ff') },
        },
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          varying vec3 vNormal;
          void main() {
            float intensity = pow(0.68 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.2);
            gl_FragColor = vec4(uColor, clamp(intensity * 0.85, 0.0, 0.75));
          }
        `,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      }),
    []
  );

  useEffect(() => {
    return () => {
      sunGlowTexture.dispose();
      earthAtmosphereMaterial.dispose();
    };
  }, [sunGlowTexture, earthAtmosphereMaterial]);

  // Dynamic Sun->Earth and Earth->Moon radius vector lines (updated imperatively in useFrame)
  const sunEarthLineObj = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(BASE_ORBIT_R, 0, 0),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.45,
    });
    return new THREE.Line(geom, mat);
  }, []);

  const earthMoonLineObj = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(BASE_MOON_R, 0, 0),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color: '#94a3b8',
      transparent: true,
      opacity: 0.5,
    });
    return new THREE.Line(geom, mat);
  }, []);

  useEffect(() => {
    return () => {
      sunEarthLineObj.geometry.dispose();
      (sunEarthLineObj.material as THREE.Material).dispose();
      earthMoonLineObj.geometry.dispose();
      (earthMoonLineObj.material as THREE.Material).dispose();
    };
  }, [sunEarthLineObj, earthMoonLineObj]);

  // Precomputed Earth elliptical orbit points
  const earthOrbitPoints = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let deg = 0; deg <= 360; deg += 2) {
      pts.push(getEarthScenePosition(deg, BASE_ORBIT_R, VIS_ECC));
    }
    return pts;
  }, []);

  // Precomputed circular Moon orbit ring in its local inclined plane
  const moonOrbitRingPoints = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let deg = 0; deg <= 360; deg += 4) {
      const rad = deg * DEG2RAD;
      pts.push([BASE_MOON_R * Math.cos(rad), 0, -BASE_MOON_R * Math.sin(rad)]);
    }
    return pts;
  }, []);

  // Prime meridian arc on Earth's surface (+X side)
  const primeMeridianPoints = useMemo(() => {
    const pts: [number, number, number][] = [];
    const r = 0.865;
    for (let lat = -90; lat <= 90; lat += 6) {
      const phi = lat * DEG2RAD;
      pts.push([r * Math.cos(phi), r * Math.sin(phi), 0]);
    }
    return pts;
  }, []);

  const perihelionPos = useMemo(
    () => getEarthScenePosition(PERIHELION_LON_DEG, BASE_ORBIT_R, VIS_ECC),
    []
  );
  const aphelionPos = useMemo(
    () => getEarthScenePosition(PERIHELION_LON_DEG + 180, BASE_ORBIT_R, VIS_ECC),
    []
  );

  // Snap camera synchronously before paint when cameraMode changes
  useLayoutEffect(() => {
    const controls = controlsRef.current;
    const t = computeOrbitalMechanicsFromJD(jdRef.current);
    const [ex, ey, ez] = getEarthScenePosition(t.lambdaE, BASE_ORBIT_R, VIS_ECC);
    lastEarthPosRef.current.set(ex, ey, ez);

    if (cameraMode === 'zenithal') {
      camera.position.set(0, 38, 0.01);
      if (controls) {
        controls.target.set(0, 0, 0);
        controls.update();
      }
    } else if (cameraMode === 'heliocentric') {
      camera.position.set(16, 17, 26);
      if (controls) {
        controls.target.set(0, 0, 0);
        controls.update();
      }
    } else if (cameraMode === 'geocentric') {
      camera.position.set(ex + 3.5, ey + 3.4, ez + 5.8);
      if (controls) {
        controls.target.set(ex, ey, ez);
        controls.update();
      }
    }
  }, [cameraMode, camera, jdRef]);

  useFrame((state, delta) => {
    if (!readyCalledRef.current) {
      readyCalledRef.current = true;
      queueMicrotask(() => onReady?.());
    }
    const clampedDelta = Math.min(0.05, delta);

    if (isPlaying) {
      const deltaDays = (clampedDelta * speedHoursPerSec) / 24;
      jdRef.current = clampOrWrapJD(jdRef.current + deltaDays);

      const now = state.clock.elapsedTime;
      if (now - lastUiSyncTimeRef.current >= 0.08) {
        lastUiSyncTimeRef.current = now;
        onTelemetrySample(jdRef.current);
      }
    }

    const t = computeOrbitalMechanicsFromJD(jdRef.current);
    const [ex, ey, ez] = getEarthScenePosition(t.lambdaE, BASE_ORBIT_R, VIS_ECC);

    if (earthSystemRef.current) {
      earthSystemRef.current.position.set(ex, ey, ez);
    }

    if (earthSpinRef.current) {
      earthSpinRef.current.rotation.y = t.GMST_deg * DEG2RAD;
    }

    const [mx, my, mz] = getMoonRelativeScenePosition(
      t.lambdaM,
      t.betaM,
      t.rM_km,
      BASE_MOON_R
    );

    if (moonRef.current) {
      moonRef.current.position.set(mx, my, mz);
      // Tidally locked Moon always faces Earth
      moonRef.current.lookAt(ex, ey, ez);
    }

    if (moonOrbitRingRef.current) {
      // Orient Moon's orbital plane by ascending node & inclination
      moonOrbitRingRef.current.rotation.set(0, 0, 0);
      moonOrbitRingRef.current.rotateY(t.omegaM * DEG2RAD);
      moonOrbitRingRef.current.rotateX(MOON_INCLINATION_DEG * DEG2RAD);
    }

    // Update Sun->Earth radius vector
    const sunEarthAttr = sunEarthLineObj.geometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    sunEarthAttr.setXYZ(1, ex, ey, ez);
    sunEarthAttr.needsUpdate = true;

    // Update Earth->Moon vector
    const earthMoonAttr = earthMoonLineObj.geometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    earthMoonAttr.setXYZ(1, mx, my, mz);
    earthMoonAttr.needsUpdate = true;

    // In geocentric mode, keep OrbitControls target locked onto Earth's motion
    if (cameraMode === 'geocentric' && controlsRef.current) {
      const dx = ex - lastEarthPosRef.current.x;
      const dy = ey - lastEarthPosRef.current.y;
      const dz = ez - lastEarthPosRef.current.z;
      controlsRef.current.target.set(ex, ey, ez);
      camera.position.x += dx;
      camera.position.y += dy;
      camera.position.z += dz;
    }
    lastEarthPosRef.current.set(ex, ey, ez);
  });

  return (
    <>
      <color attach="background" args={['#050814']} />
      <mesh>
        <sphereGeometry args={[150, 48, 32]} />
        <meshBasicMaterial
          map={starfieldMap}
          side={THREE.BackSide}
          color="#94a8cb"
          depthWrite={false}
        />
      </mesh>
      <Stars radius={120} depth={50} count={2200} factor={2.6} saturation={0.15} fade speed={0.25} />

      <ambientLight intensity={0.14} />
      <pointLight position={[0, 0, 0]} intensity={3.4} decay={0} color="#fff5dc" />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.07}
        minDistance={2.2}
        maxDistance={90}
      />

      {/* Sun at Heliocenter */}
      <group position={[0, 0, 0]}>
        <mesh>
          <sphereGeometry args={[1.65, 48, 48]} />
          <meshBasicMaterial map={sunMap} color="#ffe39a" />
        </mesh>
        <sprite scale={[7.2, 7.2, 1]}>
          <spriteMaterial
            map={sunGlowTexture}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
        {showLabels && (
          <Billboard position={[0, 2.35, 0]}>
            <Text fontSize={0.55} color="#fde68a" anchorX="center" anchorY="bottom">
              Sun
            </Text>
          </Billboard>
        )}
      </group>

      {/* Ecliptic Reference Axes */}
      <Line
        points={[
          [0, 0, 0],
          [BASE_ORBIT_R * 1.32, 0, 0],
        ]}
        color="#22c55e"
        lineWidth={1.6}
      />
      <Line
        points={[
          [-BASE_ORBIT_R * 1.25, 0, 0],
          [0, 0, 0],
        ]}
        color="#334155"
        lineWidth={1}
        dashed
        dashSize={0.5}
        gapSize={0.4}
      />
      <Line
        points={[
          [0, 0, -BASE_ORBIT_R * 1.25],
          [0, 0, BASE_ORBIT_R * 1.25],
        ]}
        color="#334155"
        lineWidth={1}
        dashed
        dashSize={0.5}
        gapSize={0.4}
      />

      {showLabels && (
        <>
          <Billboard position={[BASE_ORBIT_R * 1.36, 0.3, 0]}>
            <Text fontSize={0.5} color="#4ade80" anchorX="left">
              0° Aries (Vernal)
            </Text>
          </Billboard>
          <Billboard position={[0, 0.3, -BASE_ORBIT_R * 1.28]}>
            <Text fontSize={0.45} color="#94a3b8" anchorX="center">
              90°
            </Text>
          </Billboard>
          <Billboard position={[-BASE_ORBIT_R * 1.28, 0.3, 0]}>
            <Text fontSize={0.45} color="#94a3b8" anchorX="right">
              180°
            </Text>
          </Billboard>
          <Billboard position={[0, 0.3, BASE_ORBIT_R * 1.28]}>
            <Text fontSize={0.45} color="#94a3b8" anchorX="center">
              270°
            </Text>
          </Billboard>
        </>
      )}

      {/* Earth Keplerian Elliptical Orbit */}
      <Line points={earthOrbitPoints} color="#38bdf8" lineWidth={1.3} transparent opacity={0.45} />

      {/* Perihelion & Aphelion Markers */}
      <mesh position={perihelionPos}>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshBasicMaterial color="#94a3b8" />
      </mesh>
      <mesh position={aphelionPos}>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshBasicMaterial color="#94a3b8" />
      </mesh>
      {showLabels && (
        <>
          <Billboard position={[perihelionPos[0], 0.55, perihelionPos[2]]}>
            <Text fontSize={0.42} color="#cbd5e1">
              Perihelion (Jan)
            </Text>
          </Billboard>
          <Billboard position={[aphelionPos[0], 0.55, aphelionPos[2]]}>
            <Text fontSize={0.42} color="#cbd5e1">
              Aphelion (Jul)
            </Text>
          </Billboard>
        </>
      )}

      {/* Sun -> Earth Radius Vector */}
      <primitive object={sunEarthLineObj} />

      {/* Earth-Moon System */}
      <group ref={earthSystemRef}>
        {/* Earth Axial Obliquity (23.44 deg) */}
        <group rotation={[0, 0, -EARTH_OBLIQUITY_DEG * DEG2RAD]}>
          {/* Sidereal Spin (GMST) */}
          <group ref={earthSpinRef}>
            <mesh>
              <sphereGeometry args={[0.85, 40, 40]} />
              <meshStandardMaterial
                map={earthMap}
                roughness={0.75}
                metalness={0.05}
              />
            </mesh>
            {/* Atmospheric Fresnel Rim Glow */}
            <mesh material={earthAtmosphereMaterial}>
              <sphereGeometry args={[0.92, 40, 40]} />
            </mesh>
            {/* 0 deg GMT Prime Meridian */}
            <Line points={primeMeridianPoints} color="#f472b6" lineWidth={2} />
          </group>

          {/* Polar Axis Indicator */}
          <mesh>
            <cylinderGeometry args={[0.018, 0.018, 2.35, 8]} />
            <meshBasicMaterial color="#94a3b8" transparent opacity={0.55} />
          </mesh>
        </group>

        {showLabels && (
          <Billboard position={[0, 1.45, 0]}>
            <Text fontSize={0.45} color="#7dd3fc">
              Earth
            </Text>
          </Billboard>
        )}

        {/* Moon Inclined Orbit Ring */}
        <group ref={moonOrbitRingRef}>
          <Line
            points={moonOrbitRingPoints}
            color="#94a3b8"
            lineWidth={1}
            transparent
            opacity={0.4}
          />
        </group>

        {/* Earth -> Moon Vector */}
        <primitive object={earthMoonLineObj} />

        {/* Moon */}
        <mesh ref={moonRef}>
          <sphereGeometry args={[0.28, 32, 32]} />
          <meshStandardMaterial map={moonMap} roughness={0.9} metalness={0.02} />
        </mesh>
      </group>

      {/* Animated Rocket Mission Placeholder */}
      <RocketPlaceholder
        isPlaying={isPlaying}
        missionRunId={missionRunId}
        stellarData={stellarData}
        selectedSite={selectedSite}
        jdRef={jdRef}
        baseOrbitR={BASE_ORBIT_R}
        visEcc={VIS_ECC}
        baseMoonR={BASE_MOON_R}
      />
    </>
  );
}
