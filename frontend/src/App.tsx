import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  clampOrWrapJD,
  computeJulianDate,
  computeOrbitalMechanicsFromJD,
  daysInMonth,
  DEG2RAD,
  formatUTCString,
  jdToCalendarUTC,
} from './astronomy/ephemeris';
import {
  computeSiteSolarImpact,
  formatDms,
  generateRandomLandingSites,
  type LandingSite,
} from './astronomy/landingSites';
import { CanvasErrorBoundary } from './components/CanvasErrorBoundary';
import { MoonExplorerScene } from './components/MoonExplorerScene';
import { SolarSystemScene, type CameraMode } from './components/SolarSystemScene';
import { checkBackendHealth } from './api/ephemerisClient';

type ActiveTab = 'moon' | 'orbital';

const INITIAL_JD = computeJulianDate(2026, 11, 14, 10.67);

function LunarPhaseIcon({ elongation }: { elongation: number }) {
  const r = 11;
  const cx = 14;
  const cy = 14;
  const isWaxing = elongation <= 180;
  const cosE = Math.cos(elongation * DEG2RAD);
  const rx = Math.max(0.01, Math.abs(cosE) * r);
  const sweepOuter = isWaxing ? 1 : 0;
  const sweepInner = isWaxing ? (cosE > 0 ? 0 : 1) : cosE < 0 ? 0 : 1;

  const d = [
    `M ${cx} ${cy - r}`,
    `A ${r} ${r} 0 0 ${sweepOuter} ${cx} ${cy + r}`,
    `A ${rx} ${r} 0 0 ${sweepInner} ${cx} ${cy - r}`,
    'Z',
  ].join(' ');

  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} fill="#1e293b" stroke="#64748b" strokeWidth="1" />
      <path d={d} fill="#e2e8f0" />
    </svg>
  );
}

export function App() {
  const jdRef = useRef<number>(INITIAL_JD);
  const [displayJD, setDisplayJD] = useState<number>(INITIAL_JD);
  const [activeTab, setActiveTab] = useState<ActiveTab>('moon');
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedHoursPerSec, setSpeedHoursPerSec] = useState<number>(24);
  const [cameraMode, setCameraMode] = useState<CameraMode>('zenithal');
  const [showLabels, setShowLabels] = useState(true);
  const [showAdvancedTelemetry, setShowAdvancedTelemetry] = useState(false);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  // 3 fixed random landing sites (2 South Pole, 1 North Pole)
  const [sites] = useState<LandingSite[]>(() => generateRandomLandingSites());
  const [selectedSite, setSelectedSite] = useState<LandingSite | null>(null);
  const [hoverCoords, setHoverCoords] = useState<string>('Apunta a la superficie');
  const [moonZoomTrigger, setMoonZoomTrigger] = useState<{
    seq: number;
    factor: number;
    reset?: boolean;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    checkBackendHealth(controller.signal).then(setApiOnline);
    return () => controller.abort();
  }, []);

  const cal = useMemo(() => jdToCalendarUTC(displayJD), [displayJD]);
  const telemetry = useMemo(() => computeOrbitalMechanicsFromJD(displayJD), [displayJD]);
  const maxDays = useMemo(() => daysInMonth(cal.year, cal.month), [cal.year, cal.month]);

  const solarImpact = useMemo(
    () => (selectedSite ? computeSiteSolarImpact(selectedSite, displayJD) : null),
    [selectedSite, displayJD]
  );

  const setCalendarUTC = useCallback(
    (year: number, month: number, day: number, hour: number) => {
      const clampedDay = Math.min(day, daysInMonth(year, month));
      const nextJD = clampOrWrapJD(computeJulianDate(year, month, clampedDay, hour));
      jdRef.current = nextJD;
      setDisplayJD(nextJD);
    },
    []
  );

  const handleTelemetrySample = useCallback((jd: number) => {
    setDisplayJD(jd);
  }, []);

  const handleSelectSite = useCallback((site: LandingSite) => {
    setSelectedSite(site);
    setCameraMode('zenithal');
    setActiveTab('orbital');
  }, []);

  // Keyboard navigation in orbital view
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (activeTab !== 'orbital') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const next = clampOrWrapJD(jdRef.current + 1);
        jdRef.current = next;
        setDisplayJD(next);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = clampOrWrapJD(jdRef.current - 1);
        jdRef.current = next;
        setDisplayJD(next);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = clampOrWrapJD(jdRef.current + 1 / 24);
        jdRef.current = next;
        setDisplayJD(next);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = clampOrWrapJD(jdRef.current - 1 / 24);
        jdRef.current = next;
        setDisplayJD(next);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab]);

  return (
    <div className="app-shell">
      <div className="canvas-layer">
        <CanvasErrorBoundary>
          {activeTab === 'moon' ? (
            <Canvas
              key="moon-canvas"
              camera={{ position: [0, -1.2, 6.2], fov: 36, near: 0.05, far: 120 }}
              dpr={[1, 2]}
            >
              <Suspense fallback={null}>
                <MoonExplorerScene
                  sites={sites}
                  selectedSiteId={selectedSite?.id ?? null}
                  onSelectSite={handleSelectSite}
                  onHoverCoords={setHoverCoords}
                  zoomTrigger={moonZoomTrigger}
                />
              </Suspense>
            </Canvas>
          ) : (
            <Canvas
              key="orbital-canvas"
              camera={{ position: [0, 38, 0.01], fov: 45, near: 0.1, far: 400 }}
              dpr={[1, 2]}
            >
              <Suspense fallback={null}>
                <SolarSystemScene
                  jdRef={jdRef}
                  isPlaying={isPlaying}
                  speedHoursPerSec={speedHoursPerSec}
                  cameraMode={cameraMode}
                  showLabels={showLabels}
                  onTelemetrySample={handleTelemetrySample}
                />
              </Suspense>
            </Canvas>
          )}
        </CanvasErrorBoundary>
      </div>

      <div className="hud-overlay">
        {/* Top Header */}
        <header className="hud-card hud-header">
          <div className="title-block">
            <h1>
              {activeTab === 'moon'
                ? 'Luna — Explorador de Sitios 3D'
                : 'J2000.0 3D Ecliptic Ephemeris'}
            </h1>
            <p>
              {formatUTCString(cal.year, cal.month, cal.day, cal.hour)} &bull; Sun-Earth-Moon
              {apiOnline !== null && ` • ${apiOnline ? 'API Connected' : 'Local Ephemeris'}`}
            </p>
          </div>

          <div className="toolbar">
            {/* Primary Tab Switcher */}
            <div className="btn-group" role="tablist" aria-label="Vista principal">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'moon'}
                className={`hud-btn ${activeTab === 'moon' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('moon')}
              >
                Globo Lunar
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'orbital'}
                className={`hud-btn ${activeTab === 'orbital' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('orbital')}
              >
                Simulador Orbital
              </button>
            </div>

            {activeTab === 'orbital' && (
              <>
                <div className="btn-group" role="group" aria-label="Camera mode">
                  <button
                    type="button"
                    className={`hud-btn ${cameraMode === 'zenithal' ? 'is-active' : ''}`}
                    onClick={() => setCameraMode('zenithal')}
                  >
                    Zenital (Top)
                  </button>
                  <button
                    type="button"
                    className={`hud-btn ${cameraMode === 'heliocentric' ? 'is-active' : ''}`}
                    onClick={() => setCameraMode('heliocentric')}
                  >
                    Heliocentric 3D
                  </button>
                  <button
                    type="button"
                    className={`hud-btn ${cameraMode === 'geocentric' ? 'is-active' : ''}`}
                    onClick={() => setCameraMode('geocentric')}
                  >
                    Geocentric
                  </button>
                </div>

                <button
                  type="button"
                  className={`hud-btn ${showLabels ? 'is-active' : ''}`}
                  aria-pressed={showLabels}
                  onClick={() => setShowLabels((v) => !v)}
                >
                  Labels
                </button>

                <button
                  type="button"
                  className={`hud-btn ${showAdvancedTelemetry ? 'is-active' : ''}`}
                  aria-pressed={showAdvancedTelemetry}
                  aria-expanded={showAdvancedTelemetry}
                  aria-controls="advanced-telemetry-panel"
                  onClick={() => setShowAdvancedTelemetry((v) => !v)}
                >
                  {showAdvancedTelemetry ? 'Ocultar telemetría' : 'Vista avanzada'}
                </button>

                <button
                  type="button"
                  className={`hud-btn play-btn ${isPlaying ? 'is-playing' : ''}`}
                  aria-pressed={isPlaying}
                  onClick={() => setIsPlaying((v) => !v)}
                >
                  {isPlaying ? 'Pause' : 'Simulate'}
                </button>

                <div className="btn-group" role="radiogroup" aria-label="Simulation speed">
                  {[
                    { label: '1h/s', speed: 1 },
                    { label: '1d/s', speed: 24 },
                    { label: '1mo/s', speed: 730 },
                  ].map((item) => (
                    <button
                      key={item.speed}
                      type="button"
                      role="radio"
                      aria-checked={speedHoursPerSec === item.speed}
                      className={`hud-btn ${speedHoursPerSec === item.speed ? 'is-active' : ''}`}
                      onClick={() => setSpeedHoursPerSec(item.speed)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </header>

        {/* Initial Tab: 3D Moon Explorer Overlay */}
        {activeTab === 'moon' ? (
          <>
            <div className="moon-hero">
              <div className="moon-hero-eyebrow">01 — Sitios de alunizaje</div>
              <h2>Luna.</h2>
              <p>
                Gira el globo lunar y pincha en cualquiera de los 3 puntos fijos (2 en el Polo Sur,
                1 en el Polo Norte) para abrir la vista cenital orbital y comprobar su iluminación solar.
              </p>
            </div>

            <div className="moon-bottom-row">
              <div className="hud-card moon-coords-card">
                <span className="moon-hero-eyebrow">Punto bajo el cursor</span>
                <strong className="moon-coords-val">{hoverCoords}</strong>
              </div>

              <div className="hud-card sites-bar" role="group" aria-label="Puntos fijos en la Luna">
                {sites.map((site) => (
                  <button
                    key={site.id}
                    type="button"
                    className="site-pill"
                    onClick={() => handleSelectSite(site)}
                  >
                    <span className={`site-dot ${site.pole}`} />
                    <span>
                      {site.name} ({formatDms(site.latDeg, true)})
                    </span>
                  </button>
                ))}
              </div>

              <div className="hud-card btn-group" aria-label="Controles de cámara lunar">
                <button
                  type="button"
                  className="hud-btn"
                  aria-label="Alejar"
                  onClick={() =>
                    setMoonZoomTrigger((prev) => ({ seq: (prev?.seq ?? 0) + 1, factor: 1.25 }))
                  }
                >
                  −
                </button>
                <button
                  type="button"
                  className="hud-btn"
                  aria-label="Acercar"
                  onClick={() =>
                    setMoonZoomTrigger((prev) => ({ seq: (prev?.seq ?? 0) + 1, factor: 0.78 }))
                  }
                >
                  +
                </button>
                <button
                  type="button"
                  className="hud-btn"
                  aria-label="Restablecer vista"
                  onClick={() =>
                    setMoonZoomTrigger((prev) => ({
                      seq: (prev?.seq ?? 0) + 1,
                      factor: 1,
                      reset: true,
                    }))
                  }
                >
                  ↺
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Orbital Simulator Tab: Solar Impact Box + Optional Advanced Telemetry + Date Controls */
          <section className="hud-bottom" aria-label="Ephemeris telemetry and controls">
            {selectedSite && solarImpact && (
              <div className="hud-card solar-impact-card" role="status" aria-live="polite">
                <div className={`solar-badge ${solarImpact.sunHits ? 'lit' : 'shadow'}`}>
                  <span>{solarImpact.sunHits ? '☀' : '🌑'}</span>
                  <span>
                    {solarImpact.sunHits ? 'Impacta el Sol' : 'En sombra (sin luz solar)'}
                  </span>
                </div>

                <div className="solar-meta">
                  <strong>
                    {selectedSite.name} &middot; {formatDms(selectedSite.latDeg, true)},{' '}
                    {formatDms(selectedSite.lonDeg, false)}
                  </strong>
                  <span>
                    Elevación solar: {solarImpact.elevationDeg >= 0 ? '+' : ''}
                    {solarImpact.elevationDeg.toFixed(1)}&deg;
                  </span>
                </div>

                <div className="btn-group">
                  {sites.map((site) => (
                    <button
                      key={site.id}
                      type="button"
                      className={`hud-btn ${selectedSite.id === site.id ? 'is-active' : ''}`}
                      onClick={() => setSelectedSite(site)}
                    >
                      {site.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {showAdvancedTelemetry && (
              <div id="advanced-telemetry-panel" className="hud-card telemetry-grid">
                <div className="tel-cell">
                  <p className="tel-label">Julian Date (JD)</p>
                  <p className="tel-val">{telemetry.JD.toFixed(4)}</p>
                  <p className="tel-sub">
                    d = {telemetry.d >= 0 ? '+' : ''}
                    {telemetry.d.toFixed(2)} d (J2000)
                  </p>
                </div>
                <div className="tel-cell">
                  <p className="tel-label">Earth Longitude (&lambda;E)</p>
                  <p className="tel-val">{telemetry.lambdaE.toFixed(2)}&deg;</p>
                  <p className="tel-sub">&lambda;Sun = {telemetry.lambdaSun.toFixed(2)}&deg;</p>
                </div>
                <div className="tel-cell">
                  <p className="tel-label">Earth Radius (rE)</p>
                  <p className="tel-val">{telemetry.rE_AU.toFixed(5)} AU</p>
                  <p className="tel-sub">{Math.round(telemetry.rE_km).toLocaleString('en-US')} km</p>
                </div>
                <div className="tel-cell">
                  <p className="tel-label">Moon Longitude (&lambda;M)</p>
                  <p className="tel-val">{telemetry.lambdaM.toFixed(2)}&deg;</p>
                  <p className="tel-sub">rM = {Math.round(telemetry.rM_km).toLocaleString('en-US')} km</p>
                </div>
                <div className="tel-cell">
                  <p className="tel-label">Lunar Illumination</p>
                  <div className="tel-phase-row">
                    <LunarPhaseIcon elongation={telemetry.elongation} />
                    <div>
                      <p className="tel-val">{(telemetry.illuminatedFraction * 100).toFixed(1)}%</p>
                      <p className="tel-sub">{telemetry.phaseName}</p>
                    </div>
                  </div>
                </div>
                <div className="tel-cell">
                  <p className="tel-label">Sidereal Spin (GMST)</p>
                  <p className="tel-val">{telemetry.GMST_deg.toFixed(1)}&deg;</p>
                  <p className="tel-sub">vE = {telemetry.v_E.toFixed(2)}&deg;</p>
                </div>
              </div>
            )}

            <div className="hud-card">
              <div className="controls-grid">
                <div className="control-cell">
                  <div className="control-top">
                    <label htmlFor="ctrl-year">Year (1900–2100)</label>
                    <span className="control-val">{cal.year}</span>
                  </div>
                  <input
                    id="ctrl-year"
                    type="range"
                    min={1900}
                    max={2100}
                    step={1}
                    value={cal.year}
                    onChange={(e) =>
                      setCalendarUTC(parseInt(e.target.value, 10), cal.month, cal.day, cal.hour)
                    }
                  />
                </div>

                <div className="control-cell">
                  <div className="control-top">
                    <label htmlFor="ctrl-month">Month (UTC)</label>
                    <span className="control-val">M = {cal.month}</span>
                  </div>
                  <select
                    id="ctrl-month"
                    value={cal.month}
                    onChange={(e) =>
                      setCalendarUTC(cal.year, parseInt(e.target.value, 10), cal.day, cal.hour)
                    }
                  >
                    {[
                      '01 — January',
                      '02 — February',
                      '03 — March',
                      '04 — April',
                      '05 — May',
                      '06 — June',
                      '07 — July',
                      '08 — August',
                      '09 — September',
                      '10 — October',
                      '11 — November',
                      '12 — December',
                    ].map((label, idx) => (
                      <option key={label} value={idx + 1}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="control-cell">
                  <div className="control-top">
                    <label htmlFor="ctrl-day">Day of Month</label>
                    <span className="control-val">{cal.day}</span>
                  </div>
                  <input
                    id="ctrl-day"
                    type="range"
                    min={1}
                    max={maxDays}
                    step={1}
                    value={Math.min(cal.day, maxDays)}
                    onChange={(e) =>
                      setCalendarUTC(cal.year, cal.month, parseInt(e.target.value, 10), cal.hour)
                    }
                  />
                </div>

                <div className="control-cell">
                  <div className="control-top">
                    <label htmlFor="ctrl-hour">Hour (UTC)</label>
                    <span className="control-val">{cal.hour.toFixed(1)}h</span>
                  </div>
                  <input
                    id="ctrl-hour"
                    type="range"
                    min={0}
                    max={23.9}
                    step={0.1}
                    value={Number(cal.hour.toFixed(1))}
                    onChange={(e) =>
                      setCalendarUTC(cal.year, cal.month, cal.day, parseFloat(e.target.value))
                    }
                  />
                </div>
              </div>

              <div className="hint-strip">
                <span>Drag to orbit &bull; Scroll to zoom &bull; Right-drag to pan</span>
                <span>Keys: &larr;/&rarr; &plusmn;1 day &bull; &uarr;/&darr; &plusmn;1 hr &bull; Space Play/Pause</span>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default App;
