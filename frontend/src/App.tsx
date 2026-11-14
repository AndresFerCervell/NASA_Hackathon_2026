import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
import { MoonExplorerScene } from './components/MoonExplorerScene';
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
  const [speedHoursPerSec, setSpeedHoursPerSec] = useState<number>(24);
  const [cameraMode, setCameraMode] = useState<CameraMode>('zenithal');
  const [showLabels, setShowLabels] = useState(true);
  const [showAdvancedTelemetry, setShowAdvancedTelemetry] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  const [sites, setSites] = useState<LandingSite[]>(CURATED_LANDING_SITES);
  const [selectedSite, setSelectedSite] = useState<LandingSite | null>(CURATED_LANDING_SITES[0]);
  const {
    data: stellarData,
    handlePickLandingSite,
    isLoading: isStellarLoading,
    error: stellarError,
  } = useData();
  const [hoverCoords, setHoverCoords] = useState<string>('Apunta a la superficie');
  const [moonZoomTrigger, setMoonZoomTrigger] = useState<{
    seq: number;
    factor: number;
    reset?: boolean;
  } | null>(null);

  // Custom coordinate form state
  const [customName, setCustomName] = useState('Sitio Personalizado');
  const [customLat, setCustomLat] = useState('-85.0');
  const [customLon, setCustomLon] = useState('0.0');

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

  const handleAddCustomSite = (e: FormEvent) => {
    e.preventDefault();
    const lat = Math.max(-90, Math.min(90, Number(customLat) || 0));
    const lon = Math.max(-180, Math.min(180, Number(customLon) || 0));
    const pole: LandingSite['pole'] =
      lat <= -60 ? 'south' : lat >= 60 ? 'north' : 'equatorial';
    const newSite: LandingSite = {
      id: `custom-${Date.now()}`,
      name: customName.trim() || 'Sitio Custom',
      program: 'Custom',
      region: `${formatDms(lat, true)}, ${formatDms(lon, false)}`,
      pole,
      latDeg: lat,
      lonDeg: lon,
      isCustom: true,
    };
    setSites((prev) => [...prev, newSite]);
    setShowCustomForm(false);
    handleSelectSite(newSite);
  };

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
                ? 'Luna — Explorador de Sitios NASA 3D'
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

            <button
              type="button"
              className={`hud-btn ${showComparison ? 'is-active' : ''}`}
              aria-pressed={showComparison}
              onClick={() => setShowComparison((v) => !v)}
            >
              Comparar sitios
            </button>

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

        {/* Side-by-Side Comparison Drawer (available in both tabs) */}
        {showComparison && (
          <section className="hud-card comparison-panel" aria-label="Comparativa de sitios lunares">
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
                    {site.dateLabel && <span>Fecha: {site.dateLabel}</span>}
                  </div>
                  <div className="compare-metrics">
                    <span>
                      {impact.sunHits ? '☀ Impacta el Sol' : '🌑 En sombra'} (
                      {impact.elevationDeg >= 0 ? '+' : ''}
                      {impact.elevationDeg.toFixed(1)}&deg;)
                    </span>
                    <span>
                      {impact.earthVisible ? '📡 Tierra visible' : 'Sin vista Tierra'} (
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
                      Ver en órbita
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
              <div className="moon-hero-eyebrow">01 — Sitios de alunizaje NASA</div>
              <h2>Luna.</h2>
              <p>
                Gira el globo lunar y pincha en cualquiera de las misiones precargadas (o añade tus
                propias coordenadas) para abrir la vista cenital en su fecha oficial y comprobar su
                iluminación solar.
              </p>
            </div>

            <div className="moon-bottom-row">
              <div className="hud-card moon-coords-card">
                <span className="moon-hero-eyebrow">Punto bajo el cursor</span>
                <strong className="moon-coords-val">{hoverCoords}</strong>
              </div>

              <div className="hud-card sites-bar" role="group" aria-label="Misiones y sitios lunares">
                {sites.map((site) => (
                  <button
                    key={site.id}
                    type="button"
                    className="site-pill"
                    onClick={() => handleSelectSite(site)}
                    title={site.dateLabel ? `Fecha: ${site.dateLabel}` : site.region}
                  >
                    <span className={`site-dot ${site.pole}`} />
                    <span>{site.name}</span>
                  </button>
                ))}

                <button
                  type="button"
                  className={`hud-btn ${showCustomForm ? 'is-active' : ''}`}
                  onClick={() => setShowCustomForm((v) => !v)}
                >
                  + Coordenadas
                </button>
              </div>

              {showCustomForm && (
                <form className="hud-card custom-site-form" onSubmit={handleAddCustomSite}>
                  <div className="custom-field">
                    <label htmlFor="custom-name">Nombre</label>
                    <input
                      id="custom-name"
                      className="name-input"
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                    />
                  </div>
                  <div className="custom-field">
                    <label htmlFor="custom-lat">Lat (-90..90)</label>
                    <input
                      id="custom-lat"
                      type="number"
                      step="0.01"
                      min={-90}
                      max={90}
                      value={customLat}
                      onChange={(e) => setCustomLat(e.target.value)}
                    />
                  </div>
                  <div className="custom-field">
                    <label htmlFor="custom-lon">Lon (-180..180)</label>
                    <input
                      id="custom-lon"
                      type="number"
                      step="0.01"
                      min={-180}
                      max={180}
                      value={customLon}
                      onChange={(e) => setCustomLon(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="hud-btn is-active">
                    Añadir y ver
                  </button>
                </form>
              )}

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
                    {stellarData?.name ?? selectedSite.name} &middot;{' '}
                    {formatDms(selectedSite.latDeg, true)}, {formatDms(selectedSite.lonDeg, false)}
                  </strong>
                  <span>
                    Elevación solar: {solarImpact.elevationDeg >= 0 ? '+' : ''}
                    {solarImpact.elevationDeg.toFixed(1)}&deg; &bull;{' '}
                    {solarImpact.earthVisible ? 'Tierra visible (Comms OK)' : 'Sin vista directa a Tierra'}
                  </span>
                  {isStellarLoading && <span>Consultando viabilidad en backend...</span>}
                  {stellarError && <span>{stellarError}</span>}
                  {stellarData && (
                    <span>
                      Viabilidad: <strong>{stellarData.funciona ? 'Apto' : 'No apto'}</strong> &bull;{' '}
                      {stellarData.tipo_despegue}
                      {stellarData.tipo_fallo !== 'Ninguno' ? ` • Fallo: ${stellarData.tipo_fallo}` : ''}
                    </span>
                  )}
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
