import { useCallback, useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../types'
import { KIND_LABEL, getExtension } from '../lib/media'
import { isMobileClient, isWindowsDesktop } from '../lib/runtime'

interface LightboxProps {
  item: MediaItem | null
  posterUrl?: string | null
  /** Çift tık / Oynat: hazır olunca hemen oynat; tam ekran kullanıcı seçimiyle */
  autoPlay?: boolean
  resolveUrl: (item: MediaItem) => Promise<string | null>
  revealInFolder?: (item: MediaItem) => Promise<boolean>
  playExternally?: (
    item: MediaItem,
    player?: 'system' | 'vlc' | 'wmplayer',
  ) => Promise<boolean>
  stopPreview?: () => Promise<void>
  onClose: () => void
}

export interface PreviewBounds {
  x: number
  y: number
  width: number
  height: number
  viewport?: boolean
  dpr?: number
}

/** MP4 (ve yakın H.264 kapsayıcıları): HTML5 / GoPro index.html modeli. */
function isHtml5FriendlyVideo(name: string): boolean {
  const ext = getExtension(name)
  return ext === 'mp4' || ext === 'm4v' || ext === 'webm'
}

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
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
  // Büyük video Range istekleri Vite proxy’de takılabiliyor → doğrudan API
  return `http://127.0.0.1:5174${url}`
}

function seekTo(player: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve()
    player.addEventListener('seeked', done, { once: true })
    try {
      player.currentTime = time
    } catch {
      resolve()
      return
    }
    window.setTimeout(done, 600)
  })
}

function frameBrightness(player: HTMLVideoElement): number {
  const c = document.createElement('canvas')
  c.width = 48
  c.height = 27
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 0
  ctx.drawImage(player, 0, 0, 48, 27)
  const d = ctx.getImageData(0, 0, 48, 27).data
  let sum = 0
  let n = 0
  for (let i = 0; i < d.length; i += 4) {
    sum += d[i] + d[i + 1] + d[i + 2]
    n += 1
  }
  return n ? sum / n / 3 : 0
}

/** GoPro index.html: görünür önizleme karesi (dönüştürme yok). */
async function showVisibleFrame(player: HTMLVideoElement): Promise<number> {
  if (!player.duration || !Number.isFinite(player.duration)) {
    await seekTo(player, 0)
    return 0
  }
  const candidates = [0.2, 0.8, 1.2, Math.min(2, player.duration * 0.35)]
  let bestT = 0
  let bestAvg = -1
  for (const t of candidates) {
    const time = Math.min(Math.max(0, t), Math.max(0, player.duration - 0.05))
    await seekTo(player, time)
    let avg = 0
    try {
      avg = frameBrightness(player)
    } catch {
      avg = 0
    }
    if (avg > bestAvg) {
      bestAvg = avg
      bestT = time
    }
  }
  await seekTo(player, bestT)
  return bestT
}

/**
 * V1 oynatma:
 * - MP4/M4V/WebM → HTML5 (GoPro index.html)
 * - Diğerleri → dönüştürme YOK; masaüstünde sistem/VLC; telefonda HTML5 dene / cihazda aç
 * Çift tık / autoPlay → hemen oynat (tam ekran yapmadan) veya harici aç
 */
export function Lightbox({
  item,
  posterUrl,
  autoPlay = false,
  resolveUrl,
  revealInFolder,
  playExternally,
  stopPreview,
  onClose,
}: LightboxProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [externalHint, setExternalHint] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<'loading' | 'error' | null>('loading')
  const [overlayMsg, setOverlayMsg] = useState('Video yükleniyor…')
  const [vlcAvailable, setVlcAvailable] = useState(false)
  const [wmplayerAvailable, setWmplayerAvailable] = useState(false)
  const [externalOnly, setExternalOnly] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const readyOnceRef = useRef(false)
  const previewTimeRef = useRef(0)
  const autoPlayRef = useRef(autoPlay)
  const launchedExternalRef = useRef(false)

  const isVideo =
    item != null &&
    (item.kind === 'video' || item.kind === 'gopro' || item.kind === 'drone')
  const windowsDesktop = isWindowsDesktop()
  const mobile = isMobileClient()
  const html5Ok = item ? isHtml5FriendlyVideo(item.name) : false
  /** Masaüstünde MOV/HEVC vb. → HTML5 deneme; doğrudan harici. Telefonda dene. */
  const useHtml5Video = isVideo && (html5Ok || mobile)

  useEffect(() => {
    autoPlayRef.current = autoPlay
  }, [autoPlay])

  useEffect(() => {
    if (!item) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (
        document.fullscreenElement ||
        (document as WebkitDocument).webkitFullscreenElement
      ) {
        void (
          document.exitFullscreen?.() ||
          (document as WebkitDocument).webkitExitFullscreen?.()
        )
        return
      }
      handleClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // handleClose her render’da yeni; item değişince yeterli
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id])

  useEffect(() => {
    if (!windowsDesktop) return
    let alive = true
    void fetch('/api/players')
      .then((r) => r.json())
      .then((data: { vlc?: boolean; wmplayer?: boolean }) => {
        if (!alive) return
        setVlcAvailable(Boolean(data.vlc))
        setWmplayerAvailable(Boolean(data.wmplayer))
      })
      .catch(() => {
        if (!alive) return
        setVlcAvailable(true)
        setWmplayerAvailable(true)
      })
    return () => {
      alive = false
    }
  }, [windowsDesktop])

  const launchExternal = useCallback(
    (player: 'system' | 'vlc' | 'wmplayer') => {
      if (!item || !playExternally || mobile) return
      const labels = {
        vlc: 'VLC açılıyor…',
        wmplayer: 'Medya Player açılıyor…',
        system: 'Sistem oynatıcı açılıyor…',
      } as const
      setExternalHint(labels[player])
      setExternalOnly(true)
      setOverlay(null)
      void playExternally(item, player).then((ok) => {
        if (!ok) {
          if (player === 'system' && vlcAvailable) {
            setExternalHint('Sistem açılamadı, VLC deneniyor…')
            void playExternally(item, 'vlc').then((vlcOk) => {
              if (!vlcOk) {
                setFailed(true)
                setOverlay('error')
                setOverlayMsg(
                  'Oynatıcı açılamadı. Dosya yolu bulunamadı veya VLC kurulu değil. Kaynakta 📁 ile klasörü kontrol et.',
                )
                setExternalHint(null)
                return
              }
              setExternalHint('VLC’de açıldı.')
            })
            return
          }
          setFailed(true)
          setOverlay('error')
          setOverlayMsg(
            player === 'vlc'
              ? 'VLC açılamadı (kurulu olmayabilir).'
              : player === 'wmplayer'
                ? 'Medya Player açılamadı.'
                : 'Sistem oynatıcı açılamadı. Dosya yolu yoksa sürücüyü yeniden bağla veya VLC dene.',
          )
          setExternalHint(null)
        } else {
          setExternalHint(
            player === 'vlc'
              ? 'VLC’de açıldı.'
              : player === 'wmplayer'
                ? 'Medya Player’da açıldı.'
                : 'Sistem oynatıcıda açıldı.',
          )
        }
      })
    },
    [item, playExternally, mobile, vlcAvailable],
  )

  useEffect(() => {
    readyOnceRef.current = false
    previewTimeRef.current = 0
    launchedExternalRef.current = false
    setFailed(false)
    setExternalOnly(false)
    setExternalHint(null)
    setOverlay(isVideo ? 'loading' : null)
    setOverlayMsg('Video yükleniyor…')
    void stopPreview?.()
  }, [item?.id, isVideo, stopPreview])

  // Masaüstü + HTML5-dışı video: dönüştürme yok → hemen sistem/VLC
  useEffect(() => {
    if (!item || !isVideo) return
    if (useHtml5Video) return
    if (!windowsDesktop || !playExternally) {
      setExternalOnly(true)
      setOverlay('error')
      setOverlayMsg('Bu biçim tarayıcıda oynatılamıyor. Cihaz oynatıcısını kullan.')
      setFailed(true)
      return
    }
    if (launchedExternalRef.current) return
    launchedExternalRef.current = true
    setOverlayMsg('Sistem oynatıcıda açılıyor…')
    // Dönüştürme yok — hemen varsayılan oynatıcı (VLC isteğe bağlı düğme)
    launchExternal('system')
  }, [
    item,
    isVideo,
    useHtml5Video,
    windowsDesktop,
    playExternally,
    launchExternal,
  ])

  useEffect(() => {
    let alive = true
    const blobUrls: string[] = []
    setUrl(null)
    setDuration(null)
    setRevealing(false)
    if (!item) return
    if (isVideo && !useHtml5Video) return

    void (async () => {
      const u = await resolveUrl(item)
      if (!alive) return
      if (!u) {
        setFailed(true)
        setOverlay('error')
        setOverlayMsg('Dosyaya ulaşılamadı.')
        return
      }
      const direct = directMediaUrl(u)
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
          setOverlay(null)
          return
        } catch {
          /* img src */
        }
      }
      if (alive) {
        setUrl(direct)
        if (!isVideo) setOverlay(null)
      }
    })()
    return () => {
      alive = false
      for (const b of blobUrls) URL.revokeObjectURL(b)
    }
  }, [item, resolveUrl, isVideo, useHtml5Video])

  const enterFullscreen = async () => {
    const stage = stageRef.current
    const player = videoRef.current
    try {
      if (stage?.requestFullscreen) await stage.requestFullscreen()
      else if (stage && 'webkitRequestFullscreen' in stage) {
        await (
          stage as HTMLElement & { webkitRequestFullscreen: () => Promise<void> }
        ).webkitRequestFullscreen()
      } else if (player && 'webkitEnterFullscreen' in player) {
        ;(player as HTMLVideoElement & { webkitEnterFullscreen: () => void }).webkitEnterFullscreen()
      }
    } catch {
      /* */
    }
  }

  const exitFullscreen = async () => {
    const doc = document as WebkitDocument
    try {
      if (document.exitFullscreen) await document.exitFullscreen()
      else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen()
    } catch {
      /* */
    }
  }

  const isFullscreen = () => {
    const doc = document as WebkitDocument
    return Boolean(document.fullscreenElement || doc.webkitFullscreenElement)
  }

  const toggleFullscreen = async () => {
    if (isFullscreen()) await exitFullscreen()
    else await enterFullscreen()
  }

  const playFromStart = useCallback(async () => {
    const player = videoRef.current
    if (!player) return
    if (player.ended || player.currentTime >= (player.duration || 0) - 0.08) {
      player.currentTime = 0
    }
    try {
      await player.play()
    } catch {
      /* */
    }
  }, [])

  const onVideoReady = useCallback(
    async (player: HTMLVideoElement) => {
      if (readyOnceRef.current) {
        setOverlay(null)
        return
      }
      readyOnceRef.current = true
      const seconds = player.duration
      if (Number.isFinite(seconds)) setDuration(seconds)
      if (player.videoWidth === 0) {
        setFailed(true)
        setOverlay('error')
        setOverlayMsg(
          windowsDesktop
            ? 'Tarayıcı bu videoyu çözemedi. Medya Player veya VLC ile aç.'
            : 'Bu video burada oynatılamıyor. Cihazda açmayı dene.',
        )
        return
      }

      // Otomatik oynatma: önizleme seek’leri play’i kesmesin
      if (autoPlayRef.current) {
        autoPlayRef.current = false
        previewTimeRef.current = 0
        setOverlay(null)
        setFailed(false)
        try {
          player.currentTime = 0
        } catch {
          /* */
        }
        void playFromStart()
        return
      }

      try {
        previewTimeRef.current = await showVisibleFrame(player)
      } catch {
        try {
          await seekTo(player, 0)
        } catch {
          /* */
        }
      } finally {
        setOverlay(null)
        setFailed(false)
      }
    },
    [windowsDesktop, playFromStart],
  )

  const onVideoProblem = useCallback(() => {
    setFailed(true)
    setOverlay('error')
    if (windowsDesktop && playExternally) {
      setOverlayMsg('Tarayıcı oynatamadı. Medya Player veya VLC ile aç (dönüştürme yok).')
    } else if (mobile) {
      setOverlayMsg('Bu video burada oynatılamıyor. Cihazda aç.')
    } else {
      setOverlayMsg('Bu video tarayıcıda oynatılamıyor.')
    }
  }, [windowsDesktop, playExternally, mobile])

  const openOnDevice = () => {
    if (!url) {
      setExternalHint('Açılacak adres yok.')
      return
    }
    try {
      const opened = window.open(url, '_blank', 'noopener,noreferrer')
      if (opened) {
        setExternalHint('Cihaz oynatıcısında açıldı.')
        return
      }
    } catch {
      /* */
    }
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      void navigator
        .share({ title: item?.name ?? 'Video', url })
        .then(() => setExternalHint('Paylaşım açıldı.'))
        .catch(() => setExternalHint('Cihazda açılamadı.'))
      return
    }
    setExternalHint('Cihazda açılamadı.')
  }

  const handleClose = () => {
    // Önce kapat — tarama/toast/async iş kapanmayı engellemesin
    onClose()
    try {
      const player = videoRef.current
      if (player) {
        player.pause()
        player.removeAttribute('src')
        player.load()
      }
    } catch {
      /* */
    }
    void stopPreview?.()
    void exitFullscreen()
  }

  if (!item) return null

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
            {revealInFolder && !mobile && (
              <button
                type="button"
                className="btn btn--ghost"
                disabled={revealing}
                onClick={() => {
                  setRevealing(true)
                  setExternalHint(null)
                  void revealInFolder(item)
                    .then((ok) => {
                      setExternalHint(
                        ok
                          ? 'Klasör açıldı; dosya seçili olmalı.'
                          : 'Klasör açılamadı (yol bulunamadı). Kaynak sürücü yolu bağlı mı?',
                      )
                    })
                    .finally(() => setRevealing(false))
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
          className={`lightbox__stage${overlay ? ` is-${overlay}` : ''}`}
          onDoubleClick={() => {
            if (!isVideo) return
            if (useHtml5Video && url && !failed) void playFromStart()
            else if (windowsDesktop && playExternally) {
              launchExternal(vlcAvailable ? 'vlc' : wmplayerAvailable ? 'wmplayer' : 'system')
            }
          }}
        >
          {isVideo && useHtml5Video && url ? (
            <video
              key={url}
              ref={videoRef}
              controls
              playsInline
              {...{ 'webkit-playsinline': 'true' }}
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
                void onVideoReady(event.currentTarget)
              }}
              onCanPlay={() => {
                if (readyOnceRef.current) setOverlay(null)
              }}
              onPlaying={() => setOverlay(null)}
              onEnded={() => {
                const player = videoRef.current
                if (!player) return
                void seekTo(player, previewTimeRef.current || 0)
              }}
              onError={() => onVideoProblem()}
            />
          ) : !isVideo && url ? (
            <img
              src={url}
              alt={item.name}
              className="lightbox__media"
              onError={() => {
                setFailed(true)
                setOverlay('error')
                setOverlayMsg('Görüntü yüklenemedi.')
              }}
            />
          ) : externalOnly && isVideo ? (
            <div className="lightbox__empty" aria-live="polite">
              <div>
                <strong>
                  {externalHint || 'Harici oynatıcıda açıldı / açılıyor…'}
                </strong>
                <p style={{ marginTop: '0.5rem', opacity: 0.8, fontSize: '0.85rem' }}>
                  Dönüştürme yok — dosya doğrudan sistem oynatıcısına verildi.
                </p>
              </div>
            </div>
          ) : null}

          {overlay && !(externalOnly && !failed) && (
            <div className="lightbox__empty" aria-live="polite">
              <div>
                <strong>{overlayMsg}</strong>
              </div>
            </div>
          )}
        </div>

        {isVideo && (
          <div className="lightbox__controls">
            {useHtml5Video && (
              <>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!url || failed}
                  onClick={() => void playFromStart()}
                >
                  Oynat
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={!url}
                  onClick={() => void toggleFullscreen()}
                >
                  Tam ekran
                </button>
              </>
            )}
            {windowsDesktop && playExternally && (
              <>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() =>
                    launchExternal(wmplayerAvailable ? 'wmplayer' : 'system')
                  }
                >
                  Medya Player
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => launchExternal('vlc')}
                  title={vlcAvailable ? 'VLC’de aç' : 'VLC kurulu değilse açılamayabilir'}
                >
                  VLC’de aç
                </button>
              </>
            )}
            {mobile && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={openOnDevice}
                disabled={!url}
              >
                Cihazda aç
              </button>
            )}
            {externalHint && (
              <span className="lightbox__controls-hint">{externalHint}</span>
            )}
          </div>
        )}

        {failed && isVideo && windowsDesktop && playExternally && (
          <div className="lightbox__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() =>
                launchExternal(wmplayerAvailable ? 'wmplayer' : 'system')
              }
            >
              Medya Player’da aç
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => launchExternal('vlc')}
            >
              VLC’de aç
            </button>
          </div>
        )}

        {failed && isVideo && mobile && (
          <div className="lightbox__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={openOnDevice}
              disabled={!url}
            >
              Cihazda aç
            </button>
          </div>
        )}

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
