const rawApiUrl = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');

export const API_BASE_URL = rawApiUrl
  ? /^https?:\/\//i.test(rawApiUrl)
    ? rawApiUrl
    : `https://${rawApiUrl}`
  : '';

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}
