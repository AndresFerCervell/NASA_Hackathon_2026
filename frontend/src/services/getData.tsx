import type { StellarData } from '../model/datosEstelares';
import { apiUrl } from '../api/apiBase';

export interface GetDatosOptions {
  fecha?: Date;
  lat?: number;
  lon?: number;
  name?: string;
  onWakeupNotice?: () => void;
}

const COLD_START_STATUSES = new Set([502, 503, 504]);
const MAX_COLD_START_WAIT_MS = 95_000;
const ATTEMPT_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GET /api/landing_site_viability (with Render free-tier cold-start retry) **/
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

  const url = apiUrl(`/api/landing_site_viability?${params.toString()}`);
  const startedAt = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - startedAt < MAX_COLD_START_WAIT_MS) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal });
      window.clearTimeout(timer);

      if (COLD_START_STATUSES.has(response.status)) {
        opts.onWakeupNotice?.();
        lastError = new Error(`Backend waking up (HTTP ${response.status})`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Request failed. HTTP status: ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Response is not JSON (verify the backend is running).');
      }

      return (await response.json()) as StellarData;
    } catch (err) {
      window.clearTimeout(timer);
      const isTransient =
        err instanceof DOMException && err.name === 'AbortError'
          ? true
          : err instanceof TypeError;

      if (isTransient && Date.now() - startedAt < MAX_COLD_START_WAIT_MS) {
        opts.onWakeupNotice?.();
        lastError = err instanceof Error ? err : new Error('Network error while waking backend');
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      throw err;
    }
  }

  throw lastError ?? new Error('Backend did not respond in time.');
}
