import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Line, OrbitControls, Stars, Text, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { formatDms, geoPoint, type LandingSite } from '../astronomy/landingSites';

interface MoonExplorerSceneProps {
  sites: LandingSite[];
  selectedSiteId: string | null;
  onSelectSite: (site: LandingSite) => void;
  onHoverCoords: (text: string) => void;
  zoomTrigger: { seq: number; factor: number; reset?: boolean } | null;
}

const MOON_RADIUS = 1.72;

export function MoonExplorerScene({
  sites,
  selectedSiteId,
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
      if (!isInteractingRef.current) {
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
        {sites.map((site) => {
          const pos = geoPoint(site.latDeg, site.lonDeg, MOON_RADIUS + 0.035);
          const isHovered = hoveredId === site.id;
          const isSelected = selectedSiteId === site.id;
          const isPolarCluster = site.pole === 'south';
          const showSiteLabel = !isPolarCluster || isHovered || isSelected;
          const labelPos = geoPoint(site.latDeg, site.lonDeg, MOON_RADIUS + 0.28);
          const pinColor =
            site.pole === 'south'
              ? '#38bdf8'
              : site.pole === 'north'
                ? '#fbbf24'
                : '#34d399';

          return (
            <group key={site.id}>
              <mesh
                position={pos}
                scale={isHovered || isSelected ? 1.45 : 1}
                onClick={(e) => {
                  e.stopPropagation();
                  document.body.style.cursor = 'auto';
                  onSelectSite(site);
                }}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  setHoveredId(site.id);
                  document.body.style.cursor = 'pointer';
                }}
                onPointerOut={() => {
                  setHoveredId(null);
                  document.body.style.cursor = 'auto';
                }}
              >
                <sphereGeometry args={[0.075, 20, 20]} />
                <meshBasicMaterial color={isHovered ? '#ffffff' : pinColor} />
              </mesh>

              {/* Outer halo ring */}
              <Billboard position={pos}>
                <mesh
                  onClick={(e) => {
                    e.stopPropagation();
                    document.body.style.cursor = 'auto';
                    onSelectSite(site);
                  }}
                >
                  <ringGeometry args={[0.1, 0.135, 28]} />
                  <meshBasicMaterial
                    color={pinColor}
                    transparent
                    opacity={isHovered || isSelected ? 0.95 : 0.6}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              </Billboard>

              {showSiteLabel && (
                <Billboard
                  position={[
                    labelPos.x,
                    isPolarCluster ? labelPos.y + 0.24 : labelPos.y + 0.06,
                    labelPos.z,
                  ]}
                >
                  <Text
                    fontSize={0.11}
                    anchorY="bottom"
                    color={isHovered ? '#ffffff' : '#f1f5f9'}
                    outlineWidth={0.012}
                    outlineColor="#080b12"
                  >
                    {site.name}
                  </Text>
                </Billboard>
              )}
            </group>
          );
        })}
      </group>
    </>
  );
}
