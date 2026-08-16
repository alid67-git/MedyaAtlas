/** Masaüstü Python köprüsü — Vite dev proxy büyük video Range isteklerini boğar. */
export const DESKTOP_API_ORIGIN = 'http://127.0.0.1:5174'

/** Aynı origin `/api/...` yolunu köprünün mutlak URL'ine çevir. */
export function toDirectUrl(url: string): string {
  return url.startsWith('/api/') ? `${DESKTOP_API_ORIGIN}${url}` : url
}
