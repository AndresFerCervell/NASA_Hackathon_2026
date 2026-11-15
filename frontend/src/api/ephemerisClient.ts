import type { CalendarUTC, OrbitalTelemetry } from '../astronomy/ephemeris';
import { apiUrl } from './apiBase';

export interface EphemerisResponse {
  calendar: CalendarUTC;
  telemetry: OrbitalTelemetry;
}

export async function checkBackendHealth(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/api/health'), { signal });
    if (!res.ok) return false;
    const data = (await res.json()) as { status?: string };
    return data.status === 'ok';
  } catch {
    return false;
  }
}

export async function fetchEphemerisByJD(
  jd: number,
  signal?: AbortSignal
): Promise<EphemerisResponse | null> {
  try {
    const res = await fetch(
      apiUrl(`/api/ephemeris?jd=${encodeURIComponent(jd.toFixed(6))}`),
      {
        signal,
      }
    );
    if (!res.ok) return null;
    return (await res.json()) as EphemerisResponse;
  } catch {
    return null;
  }
}
