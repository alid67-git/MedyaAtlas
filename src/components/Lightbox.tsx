import { useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../types'
import { KIND_LABEL } from '../lib/media'

interface LightboxProps {
  item: MediaItem | null
  /** Galerideki küçük önizleme — hemen gösterilir */
  posterUrl?: string | null
  resolveUrl: (item: MediaItem) => Promise<string | null>
  resolveCompatibleVideoUrl?: (
    item: MediaItem,
    onProgress?: (percent: number | null) => void,
  ) => Promise<string | null>
  revealInFolder?: (item: MediaItem) => Promise<boolean>
  playExternally?: (
    item: MediaItem,
    player?: 'system' | 'vlc',
  ) => Promise<boolean>
  /** Masaüstü: libVLC — lightbox stage dikdörtgenine hizalı */
  previewEmbed?: (
    item: MediaItem,
    bounds: PreviewBounds,
  ) => Promise<boolean>
  updatePreviewBounds?: (bounds: PreviewBounds) => Promise<void>
  stopPreview?: () => Promise<void>
  onClose: () => void
}

export interface PreviewBounds {
  x: number
  y: number
  width: number
  height: number
  /** true: x/y = getBoundingClientRect (viewport); Python ana pencereye map eder */
  viewport?: boolean
}

function isDesktopRuntime(): boolean {
  return Boolean(
    (window as Window & { __MEDIAATLAS_DESKTOP__?: boolean }).__MEDIAATLAS_DESKTOP__,
  )
}

function measureStageBounds(el: HTMLElement): PreviewBounds {
  const rect = el.getBoundingClientRect()
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
    viewport: true,
  }
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`
}

/** Vite proxy video Range isteklerini boğar; medyayı API’ye doğrudan bağla. */
function directMediaUrl(url: string): string {
  if (
    typeof window === 'undefined' ||
    (!url.startsWith('/api/media/') && !url.startsWith('/api/transcoded/'))
  ) {
    return url
  }
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) {
    return url
  }
  return `http://127.0.0.1:5174${url}`
}

export function Lightbox({
  item,
  posterUrl,
  resolveUrl,
  resolveCompatibleVideoUrl,
  revealInFolder,
  playExternally,
  previewEmbed,
  updatePreviewBounds,
  stopPreview,
  onClose,
}: LightboxProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [failReason, setFailReason] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)
  const [convertPercent, setConvertPercent] = useState<number | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [externalHint, setExternalHint] = useState<string | null>(null)
  const [embedState, setEmbedState] = useState<
    'idle' | 'starting' | 'playing' | 'fallback' | 'error'
  >('idle')
  const [embedError, setEmbedError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const convertingRef = useRef(false)
  const usedCompatibleRef = useRef(false)

  const isVideo =
    item != null &&
    (item.kind === 'video' || item.kind === 'gopro' || item.kind === 'drone')
  const desktop = isDesktopRuntime()
  const useLibVlc = desktop && isVideo && Boolean(previewEmbed)
  const showHtml5 = isVideo && (!useLibVlc || embedState === 'fallback')

  useEffect(() => {
    if (!item) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, onClose])

  // libVLC — stage dikdörtgenine hizalı kenarlıksız katman
  useEffect(() => {
    if (!item || !useLibVlc || !previewEmbed) return
    let alive = true
    setEmbedState('starting')
    setEmbedError(null)
    setFailed(false)
    setExternalHint(null)

    const start = () => {
      const stage = stageRef.current
      if (!stage) {
        if (retries < 40) {
          retries += 1
          window.setTimeout(start, 50)
        } else if (alive) {
          setEmbedState('fallback')
          setEmbedError('Önizleme alanı hazır olmadı.')
        }
        return
      }
      const bounds = measureStageBounds(stage)
      const work = previewEmbed(item, bounds)
      const timeout = new Promise<boolean>((resolve) => {
        window.setTimeout(() => resolve(false), 10000)
      })
      void Promise.race([work, timeout]).then((ok) => {
        if (!alive) return
        if (ok) {
          setEmbedState('playing')
          setExternalHint(null)
        } else {
          setEmbedState('fallback')
          setEmbedError('libVLC zaman aşımı — HTML önizleme deneniyor.')
        }
      })
    }
    let retries = 0
    // Layout otursun diye bir frame bekle
    const raf = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(start)
    })

    return () => {
      alive = false
      window.cancelAnimationFrame(raf)
      void stopPreview?.()
    }
  }, [item, useLibVlc, previewEmbed, stopPreview])

  // Pencere / stage hareketinde VLC katmanını yeniden hizala
  useEffect(() => {
    if (!useLibVlc || embedState !== 'playing' || !updatePreviewBounds) return
    const sync = () => {
      const stage = stageRef.current
      if (!stage) return
      void updatePreviewBounds(measureStageBounds(stage))
    }
    sync()
    const timer = window.setInterval(sync, 250)
    window.addEventListener('resize', sync)
    const ro =
      typeof ResizeObserver !== 'undefined' && stageRef.current
        ? new ResizeObserver(sync)
        : null
    if (stageRef.current && ro) ro.observe(stageRef.current)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', sync)
      ro?.disconnect()
    }
  }, [useLibVlc, embedState, updatePreviewBounds])

  // Foto / HTML5 video URL — her zaman API'ye doğrudan (Vite proxy JPG/MOV bozar)
  useEffect(() => {
    let alive = true
    const blobUrls: string[] = []
    setUrl(null)
    setFailed(false)
    setFailReason(null)
    setConverting(false)
    setConvertPercent(null)
    setDuration(null)
    setRevealing(false)
    if (!useLibVlc) setExternalHint(null)
    convertingRef.current = false
    usedCompatibleRef.current = false
    if (!item) return
    if (useLibVlc && embedState !== 'fallback') return

    void (async () => {
      const u = await resolveUrl(item)
      if (!alive) return
      if (!u) {
        setFailed(true)
        setFailReason('Dosyaya ulaşılamadı.')
        return
      }
      const direct = directMediaUrl(u)
      // Fotoğraflar: blob ile yükle (WebView + relative /api yolu siyah kalabiliyor)
      if (!isVideo && (direct.includes('/api/media/') || direct.startsWith('http://127.0.0.1:5174'))) {
        try {
          const res = await fetch(direct)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const blob = await res.blob()
          if (blob.size < 32) throw new Error('empty')
          const objectUrl = URL.createObjectURL(blob)
          blobUrls.push(objectUrl)
          if (!alive) return
          setUrl(objectUrl)
          return
        } catch {
          /* img src ile dene */
        }
      }
      if (alive) setUrl(direct)
    })()
    return () => {
      alive = false
      for (const b of blobUrls) URL.revokeObjectURL(b)
    }
  }, [item, resolveUrl, isVideo, useLibVlc, embedState])

  useEffect(() => {
    if (!showHtml5 || !url || failed || converting) return
    const el = videoRef.current
    if (!el) return
    const tryPlay = () => {
      void el.play().catch(() => {})
    }
    if (el.readyState >= 3) tryPlay()
    else el.addEventListener('canplay', tryPlay, { once: true })
    return () => el.removeEventListener('canplay', tryPlay)
  }, [url, showHtml5, failed, converting])

  const makeCompatible = () => {
    if (!item || !isVideo || !resolveCompatibleVideoUrl) return
    if (convertingRef.current || usedCompatibleRef.current) return
    convertingRef.current = true
    usedCompatibleRef.current = true
    setConverting(true)
    setConvertPercent(null)
    setFailed(false)
    setFailReason(null)
    void resolveCompatibleVideoUrl(item, (percent) => {
      setConvertPercent(percent)
    }).then((compatibleUrl) => {
      convertingRef.current = false
      setConverting(false)
      setConvertPercent(null)
      if (compatibleUrl) {
        setUrl(directMediaUrl(compatibleUrl))
        return
      }
      setFailed(true)
      setFailReason(
        'Önizleme hazırlanamadı. “VLC” veya “Klasörde göster” dene.',
      )
    })
  }

  const onVideoProblem = () => {
    if (!item) return
    if (desktop) {
      usedCompatibleRef.current = true
      setFailed(false)
      setConverting(false)
      setExternalHint(
        'HTML önizleme bu videoda takılıyor. Tam VLC veya libVLC dene.',
      )
      return
    }
    if (resolveCompatibleVideoUrl && !usedCompatibleRef.current) {
      makeCompatible()
      return
    }
    setFailed(true)
    setFailReason('Bu tarayıcı bu videoyu görüntülü oynatamıyor (çoğu MOV/HEVC).')
  }

  const launchExternal = (player: 'system' | 'vlc') => {
    if (!item || !playExternally) return
    setExternalHint(player === 'vlc' ? 'VLC açılıyor…' : 'Sistem oynatıcı açılıyor…')
    void playExternally(item, player).then((ok) => {
      if (!ok) {
        setExternalHint(
          player === 'vlc'
            ? 'VLC açılamadı (kurulu olmayabilir).'
            : 'Sistem oynatıcı açılamadı.',
        )
      } else {
        setExternalHint(player === 'vlc' ? 'VLC’de açıldı.' : 'Sistem oynatıcıda açıldı.')
      }
    })
  }

  const handleClose = () => {
    void stopPreview?.()
    onClose()
  }

  if (!item) return null

  const showPosterOnly =
    isVideo &&
    !url &&
    !failed &&
    !converting &&
    !(useLibVlc && (embedState === 'starting' || embedState === 'playing'))

  return (
    <div className="lightbox" role="dialog" aria-modal="true">
      <button
        type="button"
        className="lightbox__backdrop"
        aria-label="Kapat"
        onClick={handleClose}
      />
      <div className="lightbox__panel">
        <header className="lightbox__header">
          <div>
            <p className="lightbox__kind">{KIND_LABEL[item.kind]}</p>
            <h3>{item.name}</h3>
          </div>
          <div className="lightbox__header-actions">
            {playExternally && isVideo && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => launchExternal('vlc')}
              >
                VLC
              </button>
            )}
            {revealInFolder && (
              <button
                type="button"
                className="btn btn--ghost"
                disabled={revealing}
                onClick={() => {
                  setRevealing(true)
                  void revealInFolder(item).finally(() => setRevealing(false))
                }}
              >
                {revealing ? 'Açılıyor…' : 'Klasörde göster'}
              </button>
            )}
            <button type="button" className="btn btn--ghost" onClick={handleClose}>
              Kapat
            </button>
          </div>
        </header>
        <div
          ref={stageRef}
          className={`lightbox__stage${useLibVlc && embedState !== 'fallback' ? ' is-vlc-host' : ''}`}
        >
          {useLibVlc && embedState !== 'fallback' ? (
            <div className="lightbox__vlc-slot" aria-live="polite">
              {embedState === 'starting' && (
                <p className="lightbox__offline-hint">Donanım önizleme bağlanıyor…</p>
              )}
              {embedState === 'playing' && posterUrl && (
                <img
                  src={posterUrl}
                  alt=""
                  className="lightbox__media lightbox__media--poster"
                />
              )}
              {embedState === 'playing' && (
                <p className="lightbox__offline-hint lightbox__external-hint">
                  Önizleme üstte oynuyor. Görünmüyorsa VLC dene.
                </p>
              )}
              {embedState === 'error' && (
                <>
                  <p className="lightbox__offline-hint">{embedError}</p>
                  {playExternally && (
                    <div className="lightbox__actions">
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => launchExternal('vlc')}
                      >
                        Tam VLC’de aç
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : converting ? (
            <div className="lightbox__offline">
              <p>Önizleme hazırlanıyor…</p>
              <p className="lightbox__offline-hint">
                HEVC → H.264
                {convertPercent != null ? ` (%${convertPercent})` : ''}.
                {desktop && ' İstersen “VLC” ile hemen aç.'}
              </p>
              {desktop && playExternally && (
                <div className="lightbox__actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => launchExternal('vlc')}
                  >
                    VLC’de aç
                  </button>
                </div>
              )}
            </div>
          ) : failed ? (
            <div className="lightbox__offline">
              {posterUrl ? (
                <img
                  src={posterUrl}
                  alt=""
                  className="lightbox__media lightbox__media--poster"
                />
              ) : null}
              <p>Önizleme yüklenemedi.</p>
              <p className="lightbox__offline-hint">
                {failReason || 'Dosyaya ulaşılamadı.'}
              </p>
              <div className="lightbox__actions">
                {playExternally && isVideo && (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => launchExternal('vlc')}
                  >
                    VLC’de aç
                  </button>
                )}
                {revealInFolder && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      void revealInFolder(item)
                    }}
                  >
                    Klasörde göster
                  </button>
                )}
              </div>
            </div>
          ) : showPosterOnly ? (
            <div className="lightbox__poster-wrap">
              {posterUrl ? (
                <img
                  src={posterUrl}
                  alt={item.name}
                  className="lightbox__media lightbox__media--poster"
                />
              ) : (
                <p>Yükleniyor…</p>
              )}
              <p className="lightbox__offline-hint">Video akışı bağlanıyor…</p>
            </div>
          ) : showHtml5 && url ? (
            <>
              <video
                key={url}
                ref={videoRef}
                controls
                playsInline
                preload="auto"
                poster={posterUrl ?? undefined}
                src={url}
                className="lightbox__media"
                onLoadedMetadata={(event) => {
                  const seconds = event.currentTarget.duration
                  if (Number.isFinite(seconds)) setDuration(seconds)
                  if (event.currentTarget.videoWidth === 0) onVideoProblem()
                }}
                onLoadedData={(event) => {
                  if (event.currentTarget.videoWidth === 0) onVideoProblem()
                }}
                onError={() => onVideoProblem()}
              />
              {externalHint && (
                <p className="lightbox__offline-hint lightbox__external-hint">
                  {externalHint}
                </p>
              )}
            </>
          ) : url ? (
            <img
              src={url}
              alt={item.name}
              className="lightbox__media"
              onError={() => {
                setFailed(true)
                setFailReason('Görüntü yüklenemedi.')
              }}
            />
          ) : (
            <div className="lightbox__offline">
              <p>Yükleniyor…</p>
            </div>
          )}
        </div>
        <p className="lightbox__meta">
          {item.takenAt && (
            <span className="lightbox__meta-item lightbox__meta-item--date">
              {item.takenAt.toLocaleString('tr-TR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
          {isVideo && duration !== null && (
            <span className="lightbox__meta-item">
              Süre {formatDuration(duration)}
            </span>
          )}
          <span className="lightbox__meta-item">
            {item.latitude.toFixed(6)}, {item.longitude.toFixed(6)}
          </span>
        </p>
      </div>
    </div>
  )
}
