import type { StellarData } from '../model/datosEstelares';
import { apiUrl } from '../api/apiBase';

export interface GetDatosOptions {
  fecha?: Date;
  lat?: number;
  lon?: number;
  name?: string;
}

/** GET /api/landing_site_viability **/
export async function getDatos(
  landing_site: string,
  options: GetDatosOptions | Date = {}
): Promise<StellarData> {
  const opts: GetDatosOptions =
    options instanceof Date ? { fecha: options } : options;
  const datetime = opts.fecha ?? new Date();

  const params = new URLSearchParams({
    landing_site,
    fecha: datetime.toISOString(),
  });
  if (opts.lat !== undefined) params.set('lat', String(opts.lat));
  if (opts.lon !== undefined) params.set('lon', String(opts.lon));
  if (opts.name) params.set('name', opts.name);

  const response = await fetch(
    apiUrl(`/api/landing_site_viability?${params.toString()}`),
    { method: 'GET' }
  );
  if (!response.ok) {
    throw new Error(`Request failed. HTTP status: ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Response is not JSON (verify the backend is running on port 3001).');
  }
  const data = (await response.json()) as StellarData;
  return data;
}
