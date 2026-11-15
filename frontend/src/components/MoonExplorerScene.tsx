import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Line, OrbitControls, Stars, Text, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { formatDms, geoPoint, type LandingSite } from '../astronomy/landingSites';

interface MoonExplorerSceneProps {
  sites: LandingSite[];
  selectedSiteId: string | null;
  launchingSiteId?: string | null;
  onSelectSite: (site: LandingSite) => void;
  onHoverCoords: (text: string) => void;
  zoomTrigger: { seq: number; factor: number; reset?: boolean } | null;
}

const MOON_RADIUS = 1.72;

function TargetLockPulse({ position, scale = 1 }: { position: THREE.Vector3; scale?: number }) {
  const ring1Ref = useRef<THREE.Mesh | null>(null);
  const ring2Ref = useRef<THREE.Mesh | null>(null);
  const coreRef = useRef<THREE.Mesh | null>(null);
  const clockRef = useRef(0);

  useFrame((_, delta) => {
    clockRef.current += Math.min(0.05, delta);
    const t = clockRef.current;

    const p1 = (t * 1.15) % 1;
    const p2 = (t * 1.15 + 0.5) % 1;

    if (ring1Ref.current) {
      ring1Ref.current.scale.setScalar(1 + p1 * 3.0);
      const mat1 = ring1Ref.current.material as THREE.MeshBasicMaterial;
      mat1.opacity = (1 - p1) * 0.95;
    }
    if (ring2Ref.current) {
      ring2Ref.current.scale.setScalar(1 + p2 * 3.0);
      const mat2 = ring2Ref.current.material as THREE.MeshBasicMaterial;
      mat2.opacity = (1 - p2) * 0.95;
    }
    if (coreRef.current) {
      coreRef.current.scale.setScalar(1.15 + Math.sin(t * 10) * 0.2);
    }
  });

  return (
    <Billboard position={position}>
      <group scale={scale}>
        <mesh ref={coreRef}>
          <ringGeometry args={[0.11, 0.155, 32]} />
          <meshBasicMaterial color="#ff3b3b" transparent opacity={0.95} side={THREE.DoubleSide} />
        </mesh>
        <mesh ref={ring1Ref}>
          <ringGeometry args={[0.11, 0.14, 32]} />
          <meshBasicMaterial color="#ef4444" transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
        <mesh ref={ring2Ref}>
          <ringGeometry args={[0.11, 0.14, 32]} />
          <meshBasicMaterial color="#f87171" transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </Billboard>
  );
}

export function MoonExplorerScene({
  sites,
  selectedSiteId,
  launchingSiteId = null,
  onSelectSite,
  onHoverCoords,
  zoomTrigger,
}: MoonExplorerSceneProps) {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { moonMap: moonTexture, starfieldMap } = useTexture({
    moonMap: '/textures/moon.jpg',
    starfieldMap: '/textures/stars_milky_way.jpg',
  });

  useEffect(() => {
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, []);

  // Handle zoom / reset buttons from HTML HUD
  useEffect(() => {
    if (!zoomTrigger || !controlsRef.current) return;
    const controls = controlsRef.current;
    if (zoomTrigger.reset) {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 0, 7.6);
      controls.update();
      return;
    }
    const offset = camera.position.clone().sub(controls.target).multiplyScalar(zoomTrigger.factor);
    const dist = offset.length();
    if (dist >= 2.1 && dist <= 14) {
      camera.position.copy(controls.target).add(offset);
      controls.update();
    }
  }, [zoomTrigger, camera]);

  // Selenographic graticule lines (meridians every 30 deg, parallels every 30 deg)
  const gridLines = useMemo(() => {
    const lines: [number, number, number][][] = [];
    for (let lon = -180; lon < 180; lon += 30) {
      const pts: [number, number, number][] = [];
      for (let lat = -88; lat <= 88; lat += 4) {
        const v = geoPoint(lat, lon, MOON_RADIUS + 0.01);
        pts.push([v.x, v.y, v.z]);
      }
      lines.push(pts);
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const pts: [number, number, number][] = [];
      for (let lon = -180; lon <= 180; lon += 4) {
        const v = geoPoint(lat, lon, MOON_RADIUS + 0.01);
        pts.push([v.x, v.y, v.z]);
      }
      lines.push(pts);
    }
    return lines;
  }, []);

  const northPolePos = useMemo(() => geoPoint(89.9, 0, MOON_RADIUS + 0.02), []);
  const southPolePos = useMemo(() => geoPoint(-89.9, 0, MOON_RADIUS + 0.02), []);

  // Subtle ambient star drift + gentle Moon auto-rotation & entrance scale
  const starsRef = useRef<THREE.Group | null>(null);
  const moonGroupRef = useRef<THREE.Group | null>(null);
  const isInteractingRef = useRef(false);
  const introProgressRef = useRef(0);

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta);
    if (starsRef.current) {
      starsRef.current.rotation.y += dt * 0.01;
    }
    if (moonGroupRef.current) {
      if (introProgressRef.current < 1) {
        introProgressRef.current = Math.min(1, introProgressRef.current + dt / 0.9);
        const eased = 1 - Math.pow(1 - introProgressRef.current, 3);
        moonGroupRef.current.scale.setScalar(0.88 + 0.12 * eased);
      }
      if (!isInteractingRef.current && !launchingSiteId) {
        moonGroupRef.current.rotation.y += dt * 0.045;
      }
    }
  });

  const handleSpherePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const localPoint = moonGroupRef.current
      ? moonGroupRef.current.worldToLocal(e.point.clone())
      : e.point;
    const lat = THREE.MathUtils.radToDeg(
      Math.asin(THREE.MathUtils.clamp(localPoint.y / MOON_RADIUS, -1, 1))
    );
    const lon = THREE.MathUtils.radToDeg(Math.atan2(localPoint.x, localPoint.z));
    onHoverCoords(`${formatDms(lat, true)}  ·  ${formatDms(lon, false)}`);
  };

  const handleSpherePointerOut = () => {
    onHoverCoords('Point at the surface');
  };

  return (
    <>
      <color attach="background" args={['#050814']} />
      <group ref={starsRef}>
        <mesh>
          <sphereGeometry args={[55, 48, 32]} />
          <meshBasicMaterial
            map={starfieldMap}
            side={THREE.BackSide}
            color="#9fb4d6"
            depthWrite={false}
          />
        </mesh>
        <Stars radius={34} depth={18} count={900} factor={2.0} saturation={0.1} fade speed={0.15} />
      </group>

      <ambientLight intensity={0.65} color="#b8c7e0" />
      <directionalLight position={[-4, 2.5, 5]} intensity={2.8} color="#ffead0" />
      <directionalLight position={[4, -1.5, -3]} intensity={0.35} color="#8194bd" />

      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.07}
        minDistance={2.2}
        maxDistance={12}
        rotateSpeed={0.7}
        onStart={() => {
          isInteractingRef.current = true;
        }}
        onEnd={() => {
          isInteractingRef.current = false;
        }}
      />

      <group ref={moonGroupRef} scale={0.88}>
        {/* Lunar Sphere */}
        <mesh
          onPointerMove={handleSpherePointerMove}
          onPointerOut={handleSpherePointerOut}
        >
          <sphereGeometry args={[MOON_RADIUS, 96, 72]} />
          <meshStandardMaterial map={moonTexture} roughness={0.95} metalness={0.02} />
        </mesh>

        {/* Selenographic Grid */}
        {gridLines.map((pts, idx) => (
          <Line
            key={idx}
            points={pts}
            color="#e4e1d8"
            lineWidth={0.8}
            transparent
            opacity={0.16}
          />
        ))}

        {/* North & South Pole Reference Markers */}
        <mesh position={northPolePos}>
          <sphereGeometry args={[0.032, 16, 12]} />
          <meshBasicMaterial color="#ffe8ae" />
        </mesh>
        <Billboard position={[northPolePos.x, northPolePos.y + 0.16, northPolePos.z]}>
          <Text fontSize={0.095} color="#f4eddb">
            NORTH POLE · 90° N
          </Text>
        </Billboard>

        <mesh position={southPolePos}>
          <sphereGeometry args={[0.032, 16, 12]} />
          <meshBasicMaterial color="#ffe8ae" />
        </mesh>
        <Billboard position={[southPolePos.x, southPolePos.y - 0.28, southPolePos.z]}>
          <Text fontSize={0.088} color="#f4eddb" outlineWidth={0.01} outlineColor="#080b12">
            SOUTH POLE · 90° S
          </Text>
        </Billboard>

        {/* Curated & Custom Landing Sites */}
        {(() => {
          const southSites = sites.filter((s) => s.pole === 'south');
          return sites.map((site) => {
            const pos = geoPoint(site.latDeg, site.lonDeg, MOON_RADIUS + 0.035);
            const isHovered = hoveredId === site.id;
            const isSelected = selectedSiteId === site.id;
            const isLaunching = launchingSiteId === site.id;
            const isPolarCluster = site.pole === 'south';
            const southIndex = isPolarCluster
              ? southSites.findIndex((s) => s.id === site.id)
              : -1;
            const southCount = Math.max(1, southSites.length);
            const calloutAngle = (southIndex / southCount) * Math.PI * 2 - Math.PI / 4;
            const calloutRadius = 0.98;
            const calloutY = -MOON_RADIUS - 0.36 - (southIndex % 3) * 0.18;
            const polarCalloutPos: [number, number, number] = [
              Math.sin(calloutAngle) * calloutRadius,
              calloutY,
              Math.cos(calloutAngle) * calloutRadius,
            ];

            const labelPos = geoPoint(site.latDeg, site.lonDeg, MOON_RADIUS + 0.28);
            const pinColor = isLaunching
              ? '#ef4444'
              : site.pole === 'south'
                ? '#38bdf8'
                : site.pole === 'north'
                  ? '#fbbf24'
                  : '#34d399';

            const handleLabelClick = (e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              if (launchingSiteId) return;
              document.body.style.cursor = 'auto';
              onSelectSite(site);
            };

            const handleLabelOver = (e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              if (launchingSiteId) return;
              setHoveredId(site.id);
              document.body.style.cursor = 'pointer';
            };

            const handleLabelOut = () => {
              setHoveredId(null);
              document.body.style.cursor = 'auto';
            };

            const sphereRadius = isPolarCluster ? 0.018 : 0.075;
            const ringInner = isPolarCluster ? 0.026 : 0.1;
            const ringOuter = isPolarCluster ? 0.036 : 0.135;

            return (
              <group key={site.id}>
                <mesh
                  position={pos}
                  scale={isLaunching ? 1.65 : isHovered || isSelected ? 1.45 : 1}
                >
                  <sphereGeometry args={[sphereRadius, 20, 20]} />
                  <meshBasicMaterial color={isLaunching ? '#ff3b3b' : isHovered ? '#ffffff' : pinColor} />
                </mesh>

                {isLaunching ? (
                  <TargetLockPulse position={pos} scale={isPolarCluster ? 0.45 : 1} />
                ) : (
                  /* Outer halo ring */
                  <Billboard position={pos}>
                    <mesh>
                      <ringGeometry args={[ringInner, ringOuter, 28]} />
                      <meshBasicMaterial
                        color={pinColor}
                        transparent
                        opacity={isHovered || isSelected ? 0.95 : 0.6}
                        side={THREE.DoubleSide}
                      />
                    </mesh>
                  </Billboard>
                )}

                {isPolarCluster ? (
                  <>
                    <Line
                      points={[[pos.x, pos.y, pos.z], polarCalloutPos]}
                      color={isLaunching ? '#ef4444' : isHovered || isSelected ? '#ffffff' : '#38bdf8'}
                      lineWidth={isLaunching || isHovered || isSelected ? 1.6 : 1.1}
                      transparent
                      opacity={isLaunching || isHovered || isSelected ? 0.95 : 0.7}
                    />
                    <Billboard position={polarCalloutPos}>
                      <group
                        onClick={handleLabelClick}
                        onPointerOver={handleLabelOver}
                        onPointerOut={handleLabelOut}
                      >
                        <mesh position={[0, 0, -0.005]}>
                          <planeGeometry args={[1.45, 0.24]} />
                          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                        </mesh>
                        <Text
                          fontSize={0.095}
                          anchorY="middle"
                          color={isLaunching ? '#fecaca' : isHovered ? '#ffffff' : '#e2e8f0'}
                          outlineWidth={0.012}
                          outlineColor="#080b12"
                        >
                          {site.name}
                        </Text>
                      </group>
                    </Billboard>
                  </>
                ) : (
                  <Billboard position={[labelPos.x, labelPos.y + 0.06, labelPos.z]}>
                    <group
                      onClick={handleLabelClick}
                      onPointerOver={handleLabelOver}
                      onPointerOut={handleLabelOut}
                    >
                      <mesh position={[0, 0.06, -0.005]}>
                        <planeGeometry args={[1.45, 0.24]} />
                        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                      </mesh>
                      <Text
                        fontSize={0.11}
                        anchorY="bottom"
                        color={isLaunching ? '#fecaca' : isHovered ? '#ffffff' : '#f1f5f9'}
                        outlineWidth={0.012}
                        outlineColor="#080b12"
                      >
                        {site.name}
                      </Text>
                    </group>
                  </Billboard>
                )}
              </group>
            );
          });
        })()}
      </group>
    </>
  );
}
