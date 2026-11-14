const rawApiUrl = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');

function normalizeApiBaseUrl(value: string): string {
  if (!value) return '';

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  try {
    const parsed = new URL(withProtocol);
    // Render Blueprint `fromService.property: host` injects the internal service slug
    // (e.g. "landingsite-backend-weiq") without ".onrender.com", which cannot be resolved by browsers.
    if (parsed.hostname !== 'localhost' && !parsed.hostname.includes('.')) {
      parsed.hostname = `${parsed.hostname}.onrender.com`;
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return withProtocol;
  }
}

export const API_BASE_URL = normalizeApiBaseUrl(rawApiUrl);

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}
