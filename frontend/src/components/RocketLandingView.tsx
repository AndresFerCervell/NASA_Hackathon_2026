import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Stars, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { CanvasErrorBoundary } from './CanvasErrorBoundary';
import type { FailureMode } from './RocketPlaceholder';

interface RocketLandingViewProps {
  failureMode: FailureMode;
  missionRunId: number;
  isPlaying: boolean;
}

const DURATION_SEC = 6.2;
const TOUCHDOWN_Y = 0.42;

const DEBRIS_VECTORS: [number, number, number][] = [
  [1.1, 1.8, 0.5],
  [-1.2, 2.0, -0.4],
  [0.6, 2.2, -1.1],
  [-0.8, 1.6, 1.0],
  [1.4, 1.3, -0.7],
  [-0.4, 2.4, 0.8],
];

const MODE_LABELS: Record<FailureMode, { title: string; badgeClass: string }> = {
  none: { title: 'Nominal Landing', badgeClass: 'success' },
  comms: { title: 'Failure: No Line of Sight', badgeClass: 'failed' },
  solar: { title: 'Failure: No Solar Illumination', badgeClass: 'failed' },
  slope: { title: 'Failure: Slope Too Steep', badgeClass: 'failed' },
  critical: { title: 'Critical Failure: No Sun or Link', badgeClass: 'failed' },
};

function getPhaseLabel(mode: FailureMode, p: number): string {
  if (mode === 'none') {
    if (p < 0.65) return 'Controlled descent with retro-thrusters';
    if (p < 0.8) return 'Lunar surface touchdown';
    return 'Landing successful — Systems active';
  }
  if (mode === 'comms') {
    if (p < 0.36) return 'Initial descent — Acquiring Earth link';
    if (p < 0.68) return 'No line of sight — Guidance lost';
    return 'Impact on the lunar surface';
  }
  if (mode === 'solar') {
    if (p < 0.42) return 'Descending in lunar shadow';
    if (p < 0.68) return 'Touchdown complete — No solar power, shutting down...';
    return 'Thermal failure — Surface explosion';
  }
  if (mode === 'slope') {
    if (p < 0.45) return 'Controlled descent toward landing zone';
    if (p < 0.72) return 'Touchdown on steep slope — Rocket tipping over';
    return 'Tip-over impact — Surface explosion';
  }
  if (p < 0.58) return 'Uncontrolled descent in darkness';
  return 'Critical impact and explosion';
}

interface LandingStageProps {
  failureMode: FailureMode;
  runKey: number;
  isPlaying: boolean;
  onPhaseChange: (label: string) => void;
}

function LandingStage({
  failureMode,
  runKey,
  isPlaying,
  onPhaseChange,
}: LandingStageProps) {
  const moonTexture = useTexture('/textures/moon.jpg');
  const rocketGroupRef = useRef<THREE.Group | null>(null);
  const flameRef = useRef<THREE.Mesh | null>(null);
  const beaconMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const bodyMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const dustRingRef = useRef<THREE.Mesh | null>(null);
  const shockwaveRef = useRef<THREE.Mesh | null>(null);
  const explosionGroupRef = useRef<THREE.Group | null>(null);
  const fireballInnerRef = useRef<THREE.Mesh | null>(null);
  const fireballOuterRef = useRef<THREE.Mesh | null>(null);
  const debrisRefs = useRef<(THREE.Mesh | null)[]>([]);
  const progressRef = useRef(0);
  const lastPhaseRef = useRef('');

  const hasSun = failureMode === 'none' || failureMode === 'comms' || failureMode === 'slope';
  const hasComms = failureMode === 'none' || failureMode === 'solar' || failureMode === 'slope';

  useEffect(() => {
    progressRef.current = 0;
    lastPhaseRef.current = '';
  }, [runKey, failureMode]);

  const rocks = useMemo(
    () => [
      { pos: [-1.45, 0.04, 0.7] as [number, number, number], scale: 0.14 },
      { pos: [1.3, 0.03, -0.6] as [number, number, number], scale: 0.11 },
      { pos: [0.85, 0.03, 1.1] as [number, number, number], scale: 0.09 },
      { pos: [-0.9, 0.03, -1.0] as [number, number, number], scale: 0.12 },
    ],
    []
  );

  useFrame((_, delta) => {
    if (!rocketGroupRef.current) return;

    const dt = Math.min(0.05, delta);
    if (isPlaying) {
      progressRef.current = Math.min(1, progressRef.current + dt / DURATION_SEC);
    }
    const p = progressRef.current;

    const phase = getPhaseLabel(failureMode, p);
    if (phase !== lastPhaseRef.current) {
      lastPhaseRef.current = phase;
      onPhaseChange(phase);
    }

    const rocket = rocketGroupRef.current;
    rocket.visible = true;

    // Reset transient effects each frame
    if (dustRingRef.current) dustRingRef.current.visible = false;
    if (shockwaveRef.current) shockwaveRef.current.visible = false;
    if (explosionGroupRef.current) explosionGroupRef.current.visible = false;

    if (failureMode === 'none') {
      // Controlled upright descent & soft landing
      const u = Math.min(1, p / 0.72);
      const eased = 1 - Math.pow(1 - u, 2.2);
      const y = THREE.MathUtils.lerp(2.7, TOUCHDOWN_Y, eased);
      rocket.position.set(0, y, 0);
      rocket.rotation.set(0, p * 0.4, 0);

      if (flameRef.current) {
        flameRef.current.visible = p < 0.73;
        const flicker = 0.85 + Math.sin(p * 110) * 0.2;
        flameRef.current.scale.set(1, flicker, 1);
      }

      if (beaconMatRef.current) {
        const pulse = p >= 0.72 ? 1.4 + Math.sin(p * 30) * 0.5 : 0.8;
        beaconMatRef.current.color.set('#22c55e');
        beaconMatRef.current.emissive.set('#22c55e');
        beaconMatRef.current.emissiveIntensity = pulse;
      }

      if (bodyMatRef.current) {
        bodyMatRef.current.color.set('#e2e8f0');
        bodyMatRef.current.emissive.set('#000000');
      }

      if (dustRingRef.current && p >= 0.65 && p <= 0.92) {
        const du = (p - 0.65) / 0.27;
        dustRingRef.current.visible = true;
        dustRingRef.current.scale.setScalar(0.4 + du * 2.2);
        const mat = dustRingRef.current.material as THREE.MeshBasicMaterial;
        mat.opacity = (1 - du) * 0.55;
      }
    } else if (failureMode === 'comms') {
      // Loses comms mid-descent and crashes into the lunar surface
      if (p < 0.36) {
        const u = p / 0.36;
        rocket.position.set(0, THREE.MathUtils.lerp(2.7, 1.65, u), 0);
        rocket.rotation.set(0, 0, 0);
      } else if (p < 0.68) {
        const u = (p - 0.36) / 0.32;
        const accel = u * u;
        rocket.position.set(
          u * 0.55,
          THREE.MathUtils.lerp(1.65, 0.22, accel),
          u * 0.2
        );
        rocket.rotation.set(u * 0.45, 0, -u * 1.15);
      } else {
        // Crashed on surface
        rocket.position.set(0.55, 0.22, 0.2);
        rocket.rotation.set(0.45, 0, -1.15);
      }

      if (flameRef.current) {
        flameRef.current.visible = p < 0.42;
        flameRef.current.scale.set(1, 0.6 + Math.sin(p * 90) * 0.3, 1);
      }

      if (beaconMatRef.current) {
        const lost = p >= 0.36;
        beaconMatRef.current.color.set(lost ? '#ef4444' : '#fbbf24');
        beaconMatRef.current.emissive.set(lost ? '#ef4444' : '#fbbf24');
        beaconMatRef.current.emissiveIntensity = lost ? (Math.sin(p * 60) > 0 ? 1.8 : 0.1) : 0.8;
      }

      if (bodyMatRef.current) {
        bodyMatRef.current.color.set(p >= 0.68 ? '#94a3b8' : '#e2e8f0');
        bodyMatRef.current.emissive.set('#000000');
      }

      if (p >= 0.68) {
        const eu = Math.min(1, (p - 0.68) / 0.32);
        renderExplosion(eu, 0.55, 0.2, 0.2);
      }
    } else if (failureMode === 'solar') {
      // Lands upright in darkness, powers off, then explodes
      if (p < 0.42) {
        const u = p / 0.42;
        const eased = 1 - Math.pow(1 - u, 2);
        rocket.position.set(0, THREE.MathUtils.lerp(2.7, TOUCHDOWN_Y, eased), 0);
        rocket.rotation.set(0, 0, 0);
      } else if (p < 0.68) {
        const powerDown = (p - 0.42) / 0.26;
        const jitter = powerDown > 0.7 ? Math.sin(p * 140) * 0.025 : 0;
        rocket.position.set(jitter, TOUCHDOWN_Y, 0);
        rocket.rotation.set(0, 0, jitter * 1.5);
      } else {
        // Exploded!
        rocket.visible = p < 0.73;
        rocket.position.set(0, TOUCHDOWN_Y, 0);
      }

      if (flameRef.current) {
        flameRef.current.visible = p < 0.43;
        flameRef.current.scale.set(1, 0.85 + Math.sin(p * 100) * 0.15, 1);
      }

      if (beaconMatRef.current) {
        if (p < 0.42) {
          beaconMatRef.current.color.set('#fbbf24');
          beaconMatRef.current.emissive.set('#fbbf24');
          beaconMatRef.current.emissiveIntensity = 1.1;
        } else if (p < 0.6) {
          // Flickering and shutting down
          const dim = Math.max(0, 1 - (p - 0.42) / 0.18);
          beaconMatRef.current.color.set('#334155');
          beaconMatRef.current.emissive.set('#f59e0b');
          beaconMatRef.current.emissiveIntensity = dim * (Math.sin(p * 80) > 0 ? 0.9 : 0.1);
        } else {
          // Powered off then red overload flash
          const overload = p >= 0.63 && Math.sin(p * 120) > 0;
          beaconMatRef.current.color.set(overload ? '#ef4444' : '#0f172a');
          beaconMatRef.current.emissive.set(overload ? '#ef4444' : '#000000');
          beaconMatRef.current.emissiveIntensity = overload ? 2.2 : 0;
        }
      }

      if (bodyMatRef.current) {
        if (p >= 0.62 && p < 0.72) {
          bodyMatRef.current.color.set('#fca5a5');
          bodyMatRef.current.emissive.set('#dc2626');
          bodyMatRef.current.emissiveIntensity = (p - 0.62) * 8;
        } else {
          bodyMatRef.current.color.set(p >= 0.45 ? '#64748b' : '#cbd5e1');
          bodyMatRef.current.emissive.set('#000000');
        }
      }

      if (p >= 0.68) {
        const eu = Math.min(1, (p - 0.68) / 0.32);
        renderExplosion(eu, 0, TOUCHDOWN_Y, 0);
      }
    } else if (failureMode === 'slope') {
      // Descends, touches down on a steep slope, tips over, and explodes
      if (p < 0.45) {
        const u = p / 0.45;
        const eased = 1 - Math.pow(1 - u, 2);
        rocket.position.set(0, THREE.MathUtils.lerp(2.7, TOUCHDOWN_Y, eased), 0);
        rocket.rotation.set(0, 0, 0);
      } else if (p < 0.72) {
        const u = (p - 0.45) / 0.27;
        const tipEase = u * u;
        rocket.position.set(tipEase * 0.48, THREE.MathUtils.lerp(TOUCHDOWN_Y, 0.14, tipEase), 0);
        rocket.rotation.set(0, 0, -tipEase * 1.48);
      } else {
        rocket.visible = p < 0.77;
        rocket.position.set(0.48, 0.14, 0);
        rocket.rotation.set(0, 0, -1.48);
      }

      if (flameRef.current) {
        flameRef.current.visible = p < 0.46;
        flameRef.current.scale.set(1, 0.85 + Math.sin(p * 100) * 0.15, 1);
      }

      if (beaconMatRef.current) {
        const tipping = p >= 0.45;
        beaconMatRef.current.color.set(tipping ? '#ef4444' : '#fbbf24');
        beaconMatRef.current.emissive.set(tipping ? '#ef4444' : '#fbbf24');
        beaconMatRef.current.emissiveIntensity = tipping
          ? Math.sin(p * 80) > 0
            ? 2.0
            : 0.2
          : 1.0;
      }

      if (bodyMatRef.current) {
        bodyMatRef.current.color.set('#e2e8f0');
        bodyMatRef.current.emissive.set('#000000');
      }

      if (p >= 0.72) {
        const eu = Math.min(1, (p - 0.72) / 0.28);
        renderExplosion(eu, 0.48, 0.18, 0);
      }
    } else {
      // Critical: tumbles in darkness, crashes & explodes
      if (p < 0.58) {
        const u = p / 0.58;
        rocket.position.set(
          Math.sin(u * 6) * 0.25,
          THREE.MathUtils.lerp(2.7, 0.22, u * u),
          Math.cos(u * 5) * 0.15
        );
        rocket.rotation.set(u * 3.8, u * 1.4, -u * 2.9);
      } else {
        rocket.visible = p < 0.63;
      }

      if (flameRef.current) {
        flameRef.current.visible = p < 0.25;
      }
      if (beaconMatRef.current) {
        beaconMatRef.current.color.set('#ef4444');
        beaconMatRef.current.emissive.set('#ef4444');
        beaconMatRef.current.emissiveIntensity = Math.sin(p * 90) > 0 ? 1.8 : 0;
      }
      if (bodyMatRef.current) {
        bodyMatRef.current.color.set('#94a3b8');
        bodyMatRef.current.emissive.set('#000000');
      }

      if (p >= 0.58) {
        const eu = Math.min(1, (p - 0.58) / 0.42);
        renderExplosion(eu, 0, 0.28, 0);
      }
    }

    function renderExplosion(eu: number, cx: number, cy: number, cz: number) {
      if (shockwaveRef.current) {
        shockwaveRef.current.visible = eu < 0.85;
        shockwaveRef.current.position.set(cx, 0.04, cz);
        shockwaveRef.current.scale.setScalar(0.3 + eu * 2.8);
        const smat = shockwaveRef.current.material as THREE.MeshBasicMaterial;
        smat.opacity = Math.max(0, (1 - eu / 0.85) * 0.8);
      }

      if (explosionGroupRef.current) {
        explosionGroupRef.current.visible = true;
        explosionGroupRef.current.position.set(cx, cy, cz);

        const expand = Math.sin(Math.min(1, eu * 1.3) * Math.PI * 0.5);
        const fade = Math.max(0, 1 - Math.max(0, eu - 0.35) / 0.65);

        if (fireballInnerRef.current) {
          fireballInnerRef.current.scale.setScalar(0.2 + expand * 0.95);
          const mat = fireballInnerRef.current.material as THREE.MeshBasicMaterial;
          mat.opacity = fade;
        }
        if (fireballOuterRef.current) {
          fireballOuterRef.current.scale.setScalar(0.35 + expand * 1.45);
          const mat = fireballOuterRef.current.material as THREE.MeshBasicMaterial;
          mat.opacity = fade * 0.65;
        }

        DEBRIS_VECTORS.forEach((vec, idx) => {
          const mesh = debrisRefs.current[idx];
          if (!mesh) return;
          const gravity = 2.4 * eu * eu;
          mesh.position.set(
            vec[0] * eu * 0.9,
            Math.max(-cy + 0.05, vec[1] * eu * 0.65 - gravity),
            vec[2] * eu * 0.9
          );
          mesh.rotation.set(eu * 8, eu * 6, eu * 5);
          mesh.visible = fade > 0.05;
        });
      }
    }
  });

  return (
    <>
      <color attach="background" args={[hasSun ? '#070b18' : '#02040a']} />
      <Stars radius={40} depth={20} count={900} factor={2} saturation={0} fade speed={0.2} />

      {/* Lighting reflects solar illumination */}
      <ambientLight intensity={hasSun ? 0.55 : 0.18} color={hasSun ? '#cbd5e1' : '#334155'} />
      {hasSun ? (
        <directionalLight position={[4, 5, 3]} intensity={2.7} color="#ffead0" />
      ) : (
        <directionalLight position={[-3, 3, -2]} intensity={0.35} color="#475569" />
      )}

      {/* Earth in sky only when line-of-sight is available */}
      {hasComms && (
        <mesh position={[-2.1, 2.35, -3.5]}>
          <sphereGeometry args={[0.32, 24, 24]} />
          <meshStandardMaterial
            color="#38bdf8"
            emissive="#0284c7"
            emissiveIntensity={0.45}
            roughness={0.6}
          />
        </mesh>
      )}

      {/* Lunar Surface */}
      <group
        rotation={[0, 0, failureMode === 'slope' ? -0.34 : 0]}
        position={[0, failureMode === 'slope' ? -0.05 : 0, 0]}
      >
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[5.5, 48]} />
          <meshStandardMaterial map={moonTexture} roughness={0.95} metalness={0.02} />
        </mesh>
      </group>

      {/* Surface Rocks */}
      {rocks.map((r, i) => (
        <mesh key={i} position={r.pos}>
          <dodecahedronGeometry args={[r.scale, 0]} />
          <meshStandardMaterial color={hasSun ? '#94a3b8' : '#334155'} roughness={0.95} />
        </mesh>
      ))}

      {/* Rocket */}
      <group ref={rocketGroupRef} position={[0, 2.7, 0]}>
        {/* Main Body */}
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[0.11, 0.13, 0.52, 16]} />
          <meshStandardMaterial ref={bodyMatRef} color="#e2e8f0" metalness={0.4} roughness={0.38} />
        </mesh>
        {/* Nosecone */}
        <mesh position={[0, 0.36, 0]}>
          <coneGeometry args={[0.11, 0.22, 16]} />
          <meshStandardMaterial
            color={failureMode === 'none' ? '#38bdf8' : '#f87171'}
            metalness={0.35}
            roughness={0.4}
          />
        </mesh>
        {/* Status Beacon Ring */}
        <mesh position={[0, 0.16, 0]}>
          <cylinderGeometry args={[0.115, 0.115, 0.045, 16]} />
          <meshStandardMaterial
            ref={beaconMatRef}
            color="#22c55e"
            emissive="#22c55e"
            emissiveIntensity={1}
          />
        </mesh>
        {/* Landing Legs */}
        {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((angle, idx) => (
          <group key={idx} rotation={[0, angle, 0]}>
            <mesh position={[0.15, -0.26, 0]} rotation={[0, 0, -0.45]}>
              <boxGeometry args={[0.035, 0.26, 0.035]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.5} roughness={0.4} />
            </mesh>
          </group>
        ))}
        {/* Thruster Nozzle */}
        <mesh position={[0, -0.28, 0]}>
          <cylinderGeometry args={[0.06, 0.085, 0.08, 12]} />
          <meshStandardMaterial color="#475569" metalness={0.7} roughness={0.3} />
        </mesh>
        {/* Thruster Flame */}
        <mesh ref={flameRef} position={[0, -0.46, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.085, 0.32, 12]} />
          <meshBasicMaterial color="#fb923c" transparent opacity={0.9} />
        </mesh>
      </group>

      {/* Touchdown Dust Ring */}
      <mesh ref={dustRingRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} visible={false}>
        <ringGeometry args={[0.25, 0.42, 32]} />
        <meshBasicMaterial color="#cbd5e1" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>

      {/* Impact / Explosion Shockwave */}
      <mesh ref={shockwaveRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.2, 0.45, 32]} />
        <meshBasicMaterial color="#fb923c" transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>

      {/* Explosion Fireball & Debris */}
      <group ref={explosionGroupRef} visible={false}>
        <mesh ref={fireballInnerRef}>
          <sphereGeometry args={[0.45, 18, 18]} />
          <meshBasicMaterial color="#fde047" transparent opacity={1} />
        </mesh>
        <mesh ref={fireballOuterRef}>
          <sphereGeometry args={[0.6, 18, 18]} />
          <meshBasicMaterial color="#ef4444" transparent opacity={0.7} />
        </mesh>
        {DEBRIS_VECTORS.map((_, idx) => (
          <mesh
            key={idx}
            ref={(el) => {
              debrisRefs.current[idx] = el;
            }}
          >
            <boxGeometry args={[0.08, 0.08, 0.08]} />
            <meshStandardMaterial color="#f97316" emissive="#ea580c" emissiveIntensity={0.8} />
          </mesh>
        ))}
      </group>
    </>
  );
}

export function RocketLandingView({
  failureMode,
  missionRunId,
  isPlaying,
}: RocketLandingViewProps) {
  const [replayCount, setReplayCount] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState(() => getPhaseLabel(failureMode, 0));
  const runKey = missionRunId * 1000 + replayCount;
  const meta = MODE_LABELS[failureMode];

  useEffect(() => {
    setPhaseLabel(getPhaseLabel(failureMode, 0));
  }, [failureMode, runKey]);

  useEffect(() => {
    if (!isExpanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsExpanded(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isExpanded]);

  return (
      <div className={`landing-preview-card ${isExpanded ? 'is-expanded' : ''}`}>
        <div className="landing-preview-header">
          <span className={`landing-preview-title ${meta.badgeClass}`}>
            {meta.title}
          </span>
          <div className="landing-preview-actions">
            <button
              type="button"
              className="hud-btn landing-replay-btn"
              onClick={() => setReplayCount((c) => c + 1)}
              title="Replay landing animation"
            >
              ↻ Replay
            </button>
            <button
              type="button"
              className={`hud-btn landing-replay-btn ${isExpanded ? 'is-active' : ''}`}
              onClick={() => setIsExpanded((v) => !v)}
              aria-expanded={isExpanded}
              title={isExpanded ? 'Exit fullscreen' : 'Expand to fullscreen'}
            >
              {isExpanded ? '⤡ Close' : '⤢ Expand'}
            </button>
          </div>
        </div>

        <div className="landing-canvas-wrap">
          <CanvasErrorBoundary>
            <Canvas camera={{ position: [0, 1.55, 3.8], fov: 42, near: 0.1, far: 100 }} dpr={[1, 2]}>
              <color attach="background" args={['#060d1e']} />
              <Suspense fallback={null}>
                <LandingStage
                  failureMode={failureMode}
                  runKey={runKey}
                  isPlaying={isPlaying}
                  onPhaseChange={setPhaseLabel}
                />
              </Suspense>
            </Canvas>
          </CanvasErrorBoundary>
        </div>

        <p className="landing-phase-caption">{phaseLabel}</p>
      </div>
      );
}
