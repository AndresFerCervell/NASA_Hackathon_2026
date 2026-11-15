export interface FalloDetalle {
  codigo: number;
  descripcion: string;
  mensaje_tecnico: string;
}

export interface PerdidaEvento {
  hora_detectada: number;
  intervalo_horas: [number, number];
}

export interface DatosTecnicos {
  criterio_pendiente?: string;
  pendiente_evaluada_deg?: number;
  requisito_exclusivo_luz_horas?: number;
  delta_luz_t0_deg?: number;
  delta_tierra_t0_deg?: number;
  sol_elevacion_t0_deg?: number;
  eclipse_t0?: boolean;
  horas_simuladas?: number;
  paso_maximo_horas?: number;
  horas_totales_luz?: number;
  horas_perdidas_por_eclipse?: number;
  horas_luz_sin_relieve?: number;
  horas_perdidas_por_relieve?: number;
  porcentaje_luz?: number;
  primera_perdida_luz?: PerdidaEvento | null;
  horas_totales_comunicacion?: number;
  primera_perdida_comunicacion?: PerdidaEvento | null;
}

export interface SiteEvaluation {
  version_contrato?: number;
  sitio_id?: string;
  nombre?: string;
  coordenadas?: { lat: number; lon: number };
  t0_aterrizaje?: string;
  viable?: boolean | null;
  estado?: string;
  evaluacion_completa?: boolean;
  fallos?: number[];
  detalle_fallos?: FalloDetalle[];
  diccionario_fallos?: Record<string, string>;
  criterios_no_evaluados?: Array<number | string>;
  mensaje_tecnico?: string;
  parametros_mision?: {
    max_pendiente_deg?: number;
    min_delta_sol_t0_deg?: number;
    min_delta_tierra_t0_deg?: number;
    min_angulo_solar_deg?: number;
    min_porcentaje_luz?: number;
    min_horas_supervivencia?: number | null;
  };
  cobertura_temporal?: {
    horas_solicitadas?: number;
    horas_observadas?: number | null;
    completa?: boolean;
    suficiente_para_requisito_luz?: boolean;
  };
  datos_tecnicos?: DatosTecnicos;
  metadatos_terreno?: {
    producto?: string;
    pendiente?: {
      radio_m?: number;
      pixeles_evaluados?: number;
      metodo?: string;
    };
  };
  procedencia_efemerides?: {
    fuente?: string;
    lugar?: {
      altura_m?: number;
    };
  };
}

export interface StellarData {
  name: string;
  funciona: boolean;
  tipo_despegue: string;
  tipo_fallo: string;
  evaluacion?: SiteEvaluation;
}

export type CheckStatus = 'pass' | 'fail' | 'na';

export interface CheckMetric {
  label: string;
  value: string;
}

export interface ViabilityCheckItem {
  code: number;
  displayNumber: number;
  label: string;
  status: CheckStatus;
  measured: string;
  criterion: string;
  detail: string;
  metrics: CheckMetric[];
}

const CHECK_LABELS: Record<number, string> = {
  1: 'Terrain Slope',
  2: 'Site & Ephemeris Data',
  3: 'Solar Horizon & Eclipse',
  4: 'Earth Visibility',
  5: 'Solar position',
  6: 'Illumination Duration',
  7: 'Temporal Coverage',
};

export function buildViabilityChecks(ev: SiteEvaluation): ViabilityCheckItem[] {
  const fallos = new Set(ev.fallos ?? []);
  const noEval = new Set((ev.criterios_no_evaluados ?? []).map((c) => Number(c)));
  const dt = ev.datos_tecnicos;
  const pm = ev.parametros_mision;
  const cov = ev.cobertura_temporal;
  const detailByCode = new Map((ev.detalle_fallos ?? []).map((d) => [d.codigo, d]));

  const getStatus = (code: number): CheckStatus => {
    if (fallos.has(code)) return 'fail';
    if (noEval.has(code)) return 'na';
    return 'pass';
  };

  const fmtDeg = (v: number | undefined, signed = false) =>
    v !== undefined ? `${signed && v >= 0 ? '+' : ''}${v.toFixed(2)}°` : 'N/A';

  const specs: Record<number, { measured: string; criterion: string; metrics: CheckMetric[] }> = {
    1: {
      measured: fmtDeg(dt?.pendiente_evaluada_deg),
      criterion: `Slope P95 < ${pm?.max_pendiente_deg ?? 15}°`,
      metrics: [
        { label: 'Slope (P95)', value: fmtDeg(dt?.pendiente_evaluada_deg) },
        { label: 'Max Allowed', value: `< ${pm?.max_pendiente_deg ?? 15}°` },
        {
          label: 'Elevation',
          value:
            ev.procedencia_efemerides?.lugar?.altura_m !== undefined
              ? `${ev.procedencia_efemerides.lugar.altura_m.toFixed(1)} m`
              : 'N/A',
        },
        ...(ev.metadatos_terreno?.pendiente?.radio_m !== undefined
          ? [
              {
                label: 'Sample Radius',
                value: `${ev.metadatos_terreno.pendiente.radio_m} m (${ev.metadatos_terreno.pendiente.pixeles_evaluados ?? '?'} px)`,
              },
            ]
          : []),
      ],
    },
    2: {
      measured: ev.evaluacion_completa ? 'Complete' : 'Incomplete',
      criterion: `${ev.metadatos_terreno?.producto ?? 'DEM'} + ${ev.procedencia_efemerides?.fuente ?? 'Ephemeris'}`,
      metrics: [
        { label: 'Evaluation', value: ev.evaluacion_completa ? 'Complete' : 'Incomplete' },
        { label: 'DEM Product', value: ev.metadatos_terreno?.producto ?? 'LDEM' },
        { label: 'Ephemeris', value: ev.procedencia_efemerides?.fuente ?? 'JPL Horizons' },
      ],
    },
    3: {
      measured: `${fmtDeg(dt?.delta_luz_t0_deg, true)} • Eclipse: ${dt?.eclipse_t0 ? 'Yes' : 'No'}`,
      criterion: `Horizon Δ > ${pm?.min_delta_sol_t0_deg ?? 0.5}° & no eclipse at t0`,
      metrics: [
        { label: 'Solar Horizon Margin', value: fmtDeg(dt?.delta_luz_t0_deg, true) },
        { label: 'Min Margin', value: `> ${pm?.min_delta_sol_t0_deg ?? 0.5}°` },
        { label: 'Eclipse at t0', value: dt?.eclipse_t0 ? 'Yes' : 'No' },
      ],
    },
    4: {
      measured: `${fmtDeg(dt?.delta_tierra_t0_deg, true)} (${dt?.horas_totales_comunicacion?.toFixed(1) ?? 'N/A'}h)`,
      criterion: `Earth Δ > ${pm?.min_delta_tierra_t0_deg ?? 0}° at t0`,
      metrics: [
        { label: 'Earth Margin (t0)', value: fmtDeg(dt?.delta_tierra_t0_deg, true) },
        {
          label: 'Comms Window',
          value:
            dt?.horas_totales_comunicacion !== undefined
              ? `${dt.horas_totales_comunicacion.toFixed(1)}h / ${dt.horas_simuladas ?? cov?.horas_solicitadas ?? 24}h`
              : 'N/A',
        },
        ...(dt?.primera_perdida_comunicacion
          ? [
              {
                label: 'First Comms Loss',
                value: `+${dt.primera_perdida_comunicacion.hora_detectada.toFixed(1)}h`,
              },
            ]
          : []),
      ],
    },
    5: {
      measured: fmtDeg(dt?.sol_elevacion_t0_deg, true),
      criterion: `Solar elev. > ${pm?.min_angulo_solar_deg ?? 5}° at t0`,
      metrics: [
        { label: 'Solar Elev. (t0)', value: fmtDeg(dt?.sol_elevacion_t0_deg, true) },
        { label: 'Min Required', value: `> ${pm?.min_angulo_solar_deg ?? 5}°` },
      ],
    },
    6: {
      measured:
        dt?.porcentaje_luz !== undefined
          ? `${dt.porcentaje_luz.toFixed(1)}% (${dt.horas_totales_luz?.toFixed(1) ?? 'N/A'}h)`
          : 'N/A',
      criterion: `Lit > ${pm?.min_porcentaje_luz ?? 50}% (${dt?.requisito_exclusivo_luz_horas ?? 12}h req.)`,
      metrics: [
        {
          label: 'Lit (Actual / No Relief)',
          value:
            dt?.horas_totales_luz !== undefined
              ? `${dt.horas_totales_luz.toFixed(1)}h / ${(dt.horas_luz_sin_relieve ?? dt.horas_totales_luz).toFixed(1)}h`
              : 'N/A',
        },
        {
          label: 'Lost (Relief / Eclipse)',
          value:
            dt?.horas_perdidas_por_relieve !== undefined
              ? `${dt.horas_perdidas_por_relieve.toFixed(1)}h / ${(dt.horas_perdidas_por_eclipse ?? 0).toFixed(1)}h`
              : 'N/A',
        },
        ...(dt?.primera_perdida_luz
          ? [
              {
                label: 'First Light Loss',
                value: `+${dt.primera_perdida_luz.hora_detectada.toFixed(1)}h`,
              },
            ]
          : []),
      ],
    },
    7: {
      measured:
        cov?.horas_observadas !== undefined && cov?.horas_observadas !== null
          ? `${cov.horas_observadas}h / ${cov.horas_solicitadas ?? 24}h`
          : 'N/A',
      criterion: `Window complete (${cov?.completa ? 'Yes' : 'No'}) & sufficient`,
      metrics: [
        {
          label: 'Observed / Requested',
          value:
            cov?.horas_observadas !== undefined && cov?.horas_observadas !== null
              ? `${cov.horas_observadas}h / ${cov.horas_solicitadas ?? 24}h`
              : 'N/A',
        },
        {
          label: 'Time Step',
          value: dt?.paso_maximo_horas !== undefined ? `${dt.paso_maximo_horas}h` : '1h',
        },
        {
          label: 'Window Complete',
          value: cov?.completa ? 'Yes' : 'No',
        },
      ],
    },
  };

  return [1, 3, 4, 5, 6, 7].map((code, idx) => {
    const failInfo = detailByCode.get(code);
    return {
      code,
      displayNumber: idx + 1,
      label: CHECK_LABELS[code],
      status: getStatus(code),
      measured: specs[code].measured,
      criterion: specs[code].criterion,
      detail:
        failInfo?.mensaje_tecnico ??
        ev.diccionario_fallos?.[String(code)] ??
        specs[code].criterion,
      metrics: specs[code].metrics,
    };
  });
}
