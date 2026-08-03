/** Masaüstü pywebview enjekte eder. */
export function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(
    (window as Window & { __MEDIAATLAS_DESKTOP__?: boolean }).__MEDIAATLAS_DESKTOP__,
  )
}

/** Telefon / tablet — VLC / sürücü diyaloğu gösterme. */
export function isMobileClient(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

/** Windows masaüstü (pywebview veya Windows tarayıcı); telefonda false. */
export function isWindowsDesktop(): boolean {
  if (isMobileClient()) return false
  if (isDesktopRuntime()) return true
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
}

async function probeLocalApiOnce(timeoutMs: number): Promise<boolean> {
  if (typeof fetch === 'undefined') return false

  const tryUrl = async (url: string): Promise<boolean> => {
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) return false
      const raw = await res.text()
      try {
        const data = JSON.parse(raw) as { ok?: boolean }
        return data.ok === true
      } catch {
        // Non-JSON (SPA fallback / yanlış port) = bizim API değil
        return false
      }
    } catch {
      return false
    } finally {
      window.clearTimeout(timer)
    }
  }

  // Same-origin via Vite proxy (5183 → 5174). Hardcoded host telefonda kırılır.
  if (await tryUrl('/api/health')) return true

  // Masaüstü: proxy/SW bozulursa doğrudan API (yalnızca loopback)
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === '127.0.0.1' || host === 'localhost') {
      if (await tryUrl('http://127.0.0.1:5174/api/health')) return true
    }
  }
  return false
}

/**
 * Yerel Node/Python API ayakta mı? (sürücü tarama, transcode, oynatıcı).
 * Ağır tarama sırasında event loop gecikebilir — retry + uzun timeout ile yanlış negatif azaltılır.
 */
export async function probeLocalApi(
  timeoutMs = 3500,
  attempts = 3,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await probeLocalApiOnce(timeoutMs)) return true
    if (i + 1 < attempts) {
      await new Promise<void>((r) => window.setTimeout(r, 250 * (i + 1)))
    }
  }
  return false
}

/** Sürücü listesi / tarama için API yokken gösterilecek kısa rehber. */
export function localApiMissingHint(edition: 'v1' | 'v2' = 'v2'): string {
  if (edition === 'v1') {
    return 'Yerel API yok. V1 için baslat.bat kullan (masaüstü penceresi).'
  }
  return (
    'Yerel API yok. PC’de baslat-v2.bat’ı yeniden başlat ve ' +
    'http://127.0.0.1:5183 aç (V1 portu 5173 değil).'
  )
}
