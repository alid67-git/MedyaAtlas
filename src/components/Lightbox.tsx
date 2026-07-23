import { useEffect, useState } from 'react'
import type { MediaItem } from '../types'
import { KIND_LABEL } from '../lib/media'

interface LightboxProps {
  item: MediaItem | null
  resolveUrl: (item: MediaItem) => Promise<string | null>
  onClose: () => void
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

export function Lightbox({ item, resolveUrl, onClose }: LightboxProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const [openedOnComputer, setOpenedOnComputer] = useState(false)

  useEffect(() => {
    if (!item) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, onClose])

  useEffect(() => {
    let alive = true
    setUrl(null)
    setFailed(false)
    setDuration(null)
    setOpenedOnComputer(false)
    if (!item) return
    void resolveUrl(item).then((u) => {
      if (!alive) return
      if (u) setUrl(u)
      else setFailed(true)
    })
    return () => {
      alive = false
    }
  }, [item, resolveUrl])

  if (!item) return null

  const isVideo =
    item.kind === 'video' || item.kind === 'gopro' || item.kind === 'drone'

  const openOnComputer = async () => {
    if (openedOnComputer) return
    setOpenedOnComputer(true)
    try {
      const response = await fetch('/api/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      })
      if (!response.ok) throw new Error('open failed')
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className="lightbox" role="dialog" aria-modal="true">
      <button
        type="button"
        className="lightbox__backdrop"
        aria-label="Kapat"
        onClick={onClose}
      />
      <div className="lightbox__panel">
        <header className="lightbox__header">
          <div>
            <p className="lightbox__kind">{KIND_LABEL[item.kind]}</p>
            <h3>{item.name}</h3>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Kapat
          </button>
        </header>
        <div className="lightbox__stage">
          {failed ? (
            <div className="lightbox__offline">
              <p>Bu dosyaya şu an ulaşılamıyor.</p>
              <p className="lightbox__offline-hint">
                İçinde bulunduğu disk/klasör bağlı değil ya da izin verilmedi.
                Diski takıp kaynağı “Bağlan” ile yeniden yetkilendir.
              </p>
            </div>
          ) : !url ? (
            <div className="lightbox__offline">
              <p>Yükleniyor…</p>
            </div>
          ) : isVideo ? (
            <video
              src={url}
              controls
              autoPlay
              playsInline
              className="lightbox__media"
              onLoadedMetadata={(event) => {
                const seconds = event.currentTarget.duration
                if (Number.isFinite(seconds)) setDuration(seconds)
              }}
              onError={() => void openOnComputer()}
              onLoadStart={(event) => {
                const video = event.currentTarget
                window.setTimeout(() => {
                  if (video.readyState < 2) void openOnComputer()
                }, 6000)
              }}
            />
          ) : (
            <img src={url} alt={item.name} className="lightbox__media" onError={() => void openOnComputer()} />
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
