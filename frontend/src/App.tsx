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
  CURATED_LANDING_SITES,
  formatDms,
  getQuickmapUrl,
  type LandingSite,
} from './astronomy/landingSites';
import { CanvasErrorBoundary } from './components/CanvasErrorBoundary';
import { DateTimeControlBar } from './components/DateTimeControlBar';
import { MoonExplorerScene } from './components/MoonExplorerScene';
import { getFailureMode } from './components/RocketPlaceholder';
import { RocketLandingView } from './components/RocketLandingView';
import { SolarSystemScene, type CameraMode } from './components/SolarSystemScene';
import { checkBackendHealth } from './api/ephemerisClient';
import { useData } from './hooks/useStellarData';

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
  const [cameraMode, setCameraMode] = useState<CameraMode>('zenithal');
  const [showLabels, setShowLabels] = useState(true);
  const [showAdvancedTelemetry, setShowAdvancedTelemetry] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [openMissionId, setOpenMissionId] = useState<string | null>(null);
  const missionBarRef = useRef<HTMLDivElement | null>(null);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [missionRunId, setMissionRunId] = useState(0);

  const sites = CURATED_LANDING_SITES;
  const [selectedSite, setSelectedSite] = useState<LandingSite | null>(CURATED_LANDING_SITES[0]);
  const {
    data: stellarData,
    handlePickLandingSite,
    isLoading: isStellarLoading,
    error: stellarError,
  } = useData();
  const [hoverCoords, setHoverCoords] = useState<string>('Point at the surface');
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

  useEffect(() => {
    if (!openMissionId) return;
    const onPointerDown = (e: MouseEvent) => {
      if (missionBarRef.current && !missionBarRef.current.contains(e.target as Node)) {
        setOpenMissionId(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMissionId(null);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openMissionId]);

  const cal = useMemo(() => jdToCalendarUTC(displayJD), [displayJD]);
  const telemetry = useMemo(() => computeOrbitalMechanicsFromJD(displayJD), [displayJD]);

  const solarImpact = useMemo(
    () => (selectedSite ? computeSiteSolarImpact(selectedSite, displayJD) : null),
    [selectedSite, displayJD]
  );

  const comparisonRows = useMemo(
    () =>
      sites.map((site) => ({
        site,
        impact: computeSiteSolarImpact(site, displayJD),
      })),
    [sites, displayJD]
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

  const jdToUtcDate = useCallback((jd: number) => {
    const c = jdToCalendarUTC(jd);
    const hr = Math.floor(c.hour);
    const min = Math.floor((c.hour - hr) * 60);
    return new Date(Date.UTC(c.year, c.month - 1, c.day, hr, min, 0));
  }, []);

  const handleToggleSimulate = useCallback(() => {
    setIsPlaying((prev) => {
      const nextPlaying = !prev;
      if (nextPlaying) {
        setCameraMode('geocentric');
        setMissionRunId((id) => id + 1);
        if (selectedSite) {
          handlePickLandingSite(selectedSite.id, {
            fecha: jdToUtcDate(jdRef.current),
            lat: selectedSite.latDeg,
            lon: selectedSite.lonDeg,
            name: selectedSite.name,
          });
        }
      }
      return nextPlaying;
    });
  }, [selectedSite, handlePickLandingSite, jdToUtcDate]);

  const handleSelectSite = useCallback(
    (site: LandingSite) => {
      setSelectedSite(site);
      let targetJD = jdRef.current;
      if (site.missionDate) {
        const { year, month, day, hour } = site.missionDate;
        targetJD = clampOrWrapJD(computeJulianDate(year, month, day, hour));
        jdRef.current = targetJD;
        setDisplayJD(targetJD);
      }
      const targetCal = jdToCalendarUTC(targetJD);
      const hr = Math.floor(targetCal.hour);
      const min = Math.floor((targetCal.hour - hr) * 60);
      const targetDate = new Date(
        Date.UTC(targetCal.year, targetCal.month - 1, targetCal.day, hr, min, 0)
      );
      handlePickLandingSite(site.id, {
        fecha: targetDate,
        lat: site.latDeg,
        lon: site.lonDeg,
        name: site.name,
      });
      setCameraMode('zenithal');
      setActiveTab('orbital');
    },
    [handlePickLandingSite]
  );

  // Keyboard navigation in orbital view
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (activeTab !== 'orbital') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        handleToggleSimulate();
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
  }, [activeTab, handleToggleSimulate]);

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
                  speedHoursPerSec={24}
                  cameraMode={cameraMode}
                  showLabels={showLabels}
                  onTelemetrySample={handleTelemetrySample}
                  stellarData={stellarData}
                  selectedSite={selectedSite}
                  missionRunId={missionRunId}
                />
              </Suspense>
            </Canvas>
          )}
        </CanvasErrorBoundary>
      </div>

      <div className="hud-overlay">
        {activeTab === 'orbital' && isPlaying ? (
          <aside className="hud-card sim-running-sidebar" aria-label="Running simulation telemetry">
            <div className="sim-running-header">
              <span className="sim-running-time">
                {formatUTCString(cal.year, cal.month, cal.day, cal.hour)}
              </span>
              <button
                type="button"
                className="hud-btn play-btn is-playing"
                onClick={handleToggleSimulate}
              >
                Pause
              </button>
            </div>

            {selectedSite && solarImpact && (
              <>
                {(() => {
                  const isSuccess = stellarData
                    ? stellarData.funciona
                    : solarImpact.sunHits && solarImpact.earthVisible;
                  return (
                    <div className={`solar-badge ${isSuccess ? 'success' : 'failed'}`}>
                      <span>{isSuccess ? '✓' : '✕'}</span>
                      <span>{isSuccess ? 'Success' : 'Failed'}</span>
                    </div>
                  );
                })()}

                <div className="solar-meta">
                  <strong>{stellarData?.name ?? selectedSite.name}</strong>
                  <span>
                    {formatDms(selectedSite.latDeg, true)}, {formatDms(selectedSite.lonDeg, false)}
                  </span>
                  <span>
                    Solar elevation: {solarImpact.elevationDeg >= 0 ? '+' : ''}
                    {solarImpact.elevationDeg.toFixed(1)}&deg; &bull;{' '}
                    {solarImpact.earthVisible ? 'Earth visible' : 'No Earth link'}
                  </span>
                  {isStellarLoading && <span>Computing viability...</span>}
                  {stellarError && <span>{stellarError}</span>}
                  {stellarData && (
                    <span>
                      {stellarData.tipo_despegue}
                      {stellarData.tipo_fallo !== 'None' && stellarData.tipo_fallo !== 'Ninguno'
                        ? ` • ${stellarData.tipo_fallo}`
                        : ''}
                    </span>
                  )}
                </div>

                <RocketLandingView
                  failureMode={getFailureMode(stellarData, solarImpact)}
                  missionRunId={missionRunId}
                  isPlaying={isPlaying}
                />
              </>
            )}
          </aside>
        ) : (
          <>
            {/* Top Header */}
            <header className="hud-card hud-header">
              <div className="title-block">
                <h1>
                  {activeTab === 'moon'
                    ? 'Lunar Landing Site Navigator — Moon Explorer'
                    : 'Lunar Landing Site Navigator — Orbit Simulator'}
                </h1>
                <p>
                  {formatUTCString(cal.year, cal.month, cal.day, cal.hour)} &bull; Sun-Earth-Moon
                  {apiOnline !== null && ` • ${apiOnline ? 'API Connected' : 'Local Ephemeris'}`}
                </p>
              </div>

              <div className="toolbar">
                {activeTab === 'orbital' && (
                  <>
                    <button
                      type="button"
                      className={`hud-btn ${showComparison ? 'is-active' : ''}`}
                      aria-pressed={showComparison}
                      onClick={() => setShowComparison((v) => !v)}
                    >
                      Compare Sites
                    </button>

                    <div className="btn-group" role="group" aria-label="Camera mode">
                      <button
                        type="button"
                        className={`hud-btn ${cameraMode === 'zenithal' ? 'is-active' : ''}`}
                        onClick={() => setCameraMode('zenithal')}
                      >
                        Zenithal (Top)
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
                      {showAdvancedTelemetry ? 'Hide Telemetry' : 'Advanced View'}
                    </button>
                  </>
                )}

                {/* Primary Tab Switcher (always pinned to the right) */}
                <div className="btn-group tab-switcher-fixed" role="tablist" aria-label="Main view">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'moon'}
                    className={`hud-btn ${activeTab === 'moon' ? 'is-active' : ''}`}
                    onClick={() => {
                      setShowComparison(false);
                      setActiveTab('moon');
                    }}
                  >
                    Lunar Globe
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'orbital'}
                    className={`hud-btn ${activeTab === 'orbital' ? 'is-active' : ''}`}
                    onClick={() => {
                      setOpenMissionId(null);
                      setActiveTab('orbital');
                    }}
                  >
                    Orbital Simulator
                  </button>
                </div>
              </div>
            </header>

            {/* Side-by-Side Comparison Drawer (Orbital view only) */}
            {activeTab === 'orbital' && showComparison && (
              <section className="hud-card comparison-panel" aria-label="Lunar landing site comparison">
                <div className="comparison-grid">
                  {comparisonRows.map(({ site, impact }) => (
                    <div
                      key={site.id}
                      className={`compare-card ${selectedSite?.id === site.id ? 'is-selected' : ''}`}
                    >
                      <div className="compare-card-head">
                        <div>
                          <span className="compare-program">{site.program}</span>
                          <div>
                            <strong>{site.name}</strong>
                          </div>
                        </div>
                      </div>
                      <div className="compare-metrics">
                        <span>
                          {formatDms(site.latDeg, true)}, {formatDms(site.lonDeg, false)}
                        </span>
                        {site.dateLabel && <span>Date: {site.dateLabel}</span>}
                      </div>
                      <div className="compare-metrics">
                        <span>
                          Sun: {impact.elevationDeg >= 0 ? '+' : ''}
                          {impact.elevationDeg.toFixed(1)}&deg;
                        </span>
                        <span>
                          {impact.earthVisible ? '📡 Earth visible' : 'No Earth view'} (
                          {impact.earthElevationDeg >= 0 ? '+' : ''}
                          {impact.earthElevationDeg.toFixed(1)}&deg;)
                        </span>
                      </div>
                      <div className="compare-actions">
                        <button
                          type="button"
                          className="hud-btn is-active"
                          onClick={() => handleSelectSite(site)}
                        >
                          View in Orbit
                        </button>
                        <a
                          className="quickmap-link"
                          href={getQuickmapUrl(site.latDeg, site.lonDeg)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          LROC QuickMap ↗
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Initial Tab: 3D Moon Explorer Overlay */}
            {activeTab === 'moon' ? (
              <>
                <div className="moon-hero">
                  <div className="moon-hero-eyebrow">01 — One Safe Step For Mankind (OSSM)</div>
                  <h2>Moon.</h2>
                  <p>
                    Rotate the lunar globe and click any of the preloaded missions to open the zenithal
                    view at its official date and verify solar illumination.
                  </p>
                </div>

                <div className="moon-bottom-row">
                  <div className="hud-card moon-coords-card">
                    <span className="moon-hero-eyebrow">Cursor Coordinates</span>
                    <strong className="moon-coords-val">{hoverCoords}</strong>
                  </div>

                  <div className="sites-bar-wrap" ref={missionBarRef}>
                    {(() => {
                      const activeMission = sites.find((s) => s.id === openMissionId);
                      if (!activeMission) return null;
                      const missionJD = activeMission.missionDate
                        ? clampOrWrapJD(
                            computeJulianDate(
                              activeMission.missionDate.year,
                              activeMission.missionDate.month,
                              activeMission.missionDate.day,
                              activeMission.missionDate.hour
                            )
                          )
                        : displayJD;
                      const missionImpact = computeSiteSolarImpact(activeMission, missionJD);

                      return (
                        <div
                          className="hud-card mission-dropdown-card"
                          role="region"
                          aria-label={`${activeMission.name} details`}
                        >
                          <div className="compare-card-head">
                            <div>
                              <span className="compare-program">{activeMission.program}</span>
                              <div>
                                <strong>{activeMission.name}</strong>
                              </div>
                              <span className="mission-region">{activeMission.region}</span>
                            </div>
                          </div>

                          <div className="compare-metrics">
                            <span>
                              {formatDms(activeMission.latDeg, true)},{' '}
                              {formatDms(activeMission.lonDeg, false)}
                            </span>
                            {activeMission.dateLabel && <span>Date: {activeMission.dateLabel}</span>}
                          </div>

                          <div className="compare-metrics">
                            <span>
                              Sun: {missionImpact.elevationDeg >= 0 ? '+' : ''}
                              {missionImpact.elevationDeg.toFixed(1)}&deg;
                            </span>
                            <span>
                              {missionImpact.earthVisible ? '📡 Earth visible' : 'No Earth view'} (
                              {missionImpact.earthElevationDeg >= 0 ? '+' : ''}
                              {missionImpact.earthElevationDeg.toFixed(1)}&deg;)
                            </span>
                          </div>

                          <div className="compare-actions">
                            <button
                              type="button"
                              className="hud-btn is-active"
                              onClick={() => {
                                setOpenMissionId(null);
                                handleSelectSite(activeMission);
                              }}
                            >
                              View in Orbit
                            </button>
                            <a
                              className="quickmap-link"
                              href={getQuickmapUrl(activeMission.latDeg, activeMission.lonDeg)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              LROC QuickMap ↗
                            </a>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="hud-card sites-bar" role="group" aria-label="Lunar missions and sites">
                      {sites.map((site) => {
                        const isOpen = openMissionId === site.id;
                        return (
                          <button
                            key={site.id}
                            type="button"
                            className={`site-pill ${isOpen ? 'is-open' : ''}`}
                            aria-expanded={isOpen}
                            onClick={() => setOpenMissionId((prev) => (prev === site.id ? null : site.id))}
                            title={site.dateLabel ? `Date: ${site.dateLabel}` : site.region}
                          >
                            <span className={`site-dot ${site.pole}`} />
                            <span>{site.name}</span>
                            <span className="site-pill-chevron" aria-hidden="true">
                              {isOpen ? '▴' : '▾'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="hud-card btn-group" aria-label="Lunar camera controls">
                    <button
                      type="button"
                      className="hud-btn"
                      aria-label="Zoom out"
                      onClick={() =>
                        setMoonZoomTrigger((prev) => ({ seq: (prev?.seq ?? 0) + 1, factor: 1.25 }))
                      }
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className="hud-btn"
                      aria-label="Zoom in"
                      onClick={() =>
                        setMoonZoomTrigger((prev) => ({ seq: (prev?.seq ?? 0) + 1, factor: 0.78 }))
                      }
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="hud-btn"
                      aria-label="Reset view"
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
                    <div className="solar-meta">
                      <strong>
                        {stellarData?.name ?? selectedSite.name} &middot;{' '}
                        {formatDms(selectedSite.latDeg, true)}, {formatDms(selectedSite.lonDeg, false)}
                      </strong>
                      <span>
                        Solar elevation: {solarImpact.elevationDeg >= 0 ? '+' : ''}
                        {solarImpact.elevationDeg.toFixed(1)}&deg; &bull;{' '}
                        {solarImpact.earthVisible ? 'Earth visible (Comms OK)' : 'No direct Earth view'}
                      </span>
                      {isStellarLoading && <span>Loading site telemetry...</span>}
                      {stellarError && <span>{stellarError}</span>}
                    </div>

                    <div className="btn-group">
                      {sites.map((site) => (
                        <button
                          key={site.id}
                          type="button"
                          className={`hud-btn ${selectedSite.id === site.id ? 'is-active' : ''}`}
                          onClick={() => handleSelectSite(site)}
                        >
                          {site.name}
                        </button>
                      ))}
                    </div>

                    <a
                      className="quickmap-link"
                      href={getQuickmapUrl(selectedSite.latDeg, selectedSite.lonDeg)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      LROC QuickMap ↗
                    </a>
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
                  <div className="controls-bar-layout">
                    <div className="controls-left-col">
                      <DateTimeControlBar
                        year={cal.year}
                        month={cal.month}
                        day={cal.day}
                        hour={cal.hour}
                        onChangeUTC={setCalendarUTC}
                      />
                      <div className="hint-strip">
                        <span>Drag to orbit &bull; Scroll to zoom &bull; &larr;/&rarr; &plusmn;1 day &bull; Space Simulate</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="simulate-cta"
                      aria-pressed={isPlaying}
                      onClick={handleToggleSimulate}
                    >
                      ▶ Simulate Launch
                    </button>
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default App;
