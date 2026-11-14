/** Lunar-site geometry. Angles are geometric; azimuth is clockwise from lunar north. */
export interface LunarPlace {
  nombre?: string;
  latitud_deg: number;
  longitud_deg: number;
  /** Metres above the Horizons lunar reference surface, not above local terrain. */
  altura_m?: number;
}

export interface LunarGeometryRequest {
  lugar: LunarPlace;
  /** ISO 8601 including Z or a UTC offset, e.g. 1969-07-20T20:17:40Z. */
  inicio_utc: string;
  duracion_segundos: number;
  /** Integer multiple of 60. Duration zero requests just the starting instant. */
  paso_segundos: number;
}

export interface LunarSample {
  tiempo_utc: string;
  t_segundos: number;
  tierra_x_km: number;
  tierra_y_km: number;
  tierra_z_km: number;
  sol_x_km: number;
  sol_y_km: number;
  sol_z_km: number;
  distancia_tierra_km: number;
  distancia_sol_km: number;
  elevacion_tierra_deg: number;
  elevacion_sol_deg: number;
  /** Null where azimuth is undefined (pole or zenith/nadir). */
  acimut_tierra_deg: number | null;
  acimut_sol_deg: number | null;
  angulo_normal_tierra_deg: number;
  angulo_normal_sol_deg: number;
  tierra_visible: boolean;
  conexion_tierra: boolean;
  sol_sobre_horizonte: boolean;
  tierra_bloquea_sol: boolean;
  iluminado_sin_terreno: boolean;
  iluminado: boolean;
}

export interface LunarGeometryResponse {
  lugar: Required<LunarPlace>;
  inicio_utc: string;
  duracion_segundos: number;
  paso_segundos: number;
  total_muestras: number;
  fuente: 'JPL Horizons';
  marco: 'ICRF';
  unidades: Record<string, string>;
  modelo: Record<string, string | boolean | number>;
  datos: LunarSample[];
}

export class LunarGeometryError extends Error {
  constructor(public readonly status: number, public readonly detail: unknown) {
    super(`Lunar geometry request failed (${status})`);
    this.name = 'LunarGeometryError';
  }
}

/** Errors are propagated so the UI can distinguish validation, availability and cancellation. */
export async function fetchLunarGeometry(
  request: LunarGeometryRequest,
  signal?: AbortSignal
): Promise<LunarGeometryResponse> {
  const response = await fetch('/api/lunar-geometry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new LunarGeometryError(response.status, body);
  }
  return (await response.json()) as LunarGeometryResponse;
}
