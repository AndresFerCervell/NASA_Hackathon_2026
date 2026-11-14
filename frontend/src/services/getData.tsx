import type { StellarData } from '../model/datosEstelares';
import { apiUrl } from '../api/apiBase';

export interface GetDatosOptions {
  fecha?: Date;
  lat?: number;
  lon?: number;
  name?: string;
}

/** GET /api/{landing_site} **/
export async function getDatos(
  landing_site: string,
  options: GetDatosOptions | Date = {}
): Promise<StellarData> {
  const opts: GetDatosOptions =
    options instanceof Date ? { fecha: options } : options;
  const datetime = opts.fecha ?? new Date();

  const params = new URLSearchParams({
    fecha: datetime.toISOString(),
  });
  if (opts.lat !== undefined) params.set('lat', String(opts.lat));
  if (opts.lon !== undefined) params.set('lon', String(opts.lon));
  if (opts.name) params.set('name', opts.name);

  const response = await fetch(
    apiUrl(`/api/${encodeURIComponent(landing_site)}?${params.toString()}`),
    { method: 'GET' }
  );
  if (!response.ok) {
    throw new Error(`No se ha podido conseguir respuesta. Código HTTP: ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('La respuesta no es JSON (verifica que el backend esté arrancado en el puerto 3001).');
  }
  const data = (await response.json()) as StellarData;
  return data;
}
