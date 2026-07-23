import {
  Fragment,
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import type { MediaItem } from '../types'
import type { ThumbInfo } from '../App'
import { KIND_LABEL } from '../lib/media'

// Aynı anda yüzlerce video önizlemesi üretmek Chrome sekmesini ağırlaştırır.
const MAX_VISIBLE = 96

type ThumbSize = 'small' | 'medium' | 'large'

const THUMB_PX: Record<ThumbSize, number> = {
  small: 64,
  medium: 96,
  large: 148,
}

const SIZE_KEY = 'konumnerede-thumb-size'

function loadThumbSize(): ThumbSize {
  const saved = localStorage.getItem(SIZE_KEY)
  return saved === 'small' || saved === 'medium' || saved === 'large'
    ? saved
    : 'medium'
}

interface MediaGalleryProps {
  items: MediaItem[]
  locationMode: 'located' | 'missing'
  resolveThumb: (item: MediaItem) => Promise<ThumbInfo | null>
  pathForItem: (item: MediaItem) => string
  onOpen: (item: MediaItem) => void
  onReconnect: (sourceId: string) => void
  onCopyPath: (item: MediaItem) => void
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDayHeading(date: Date): string {
  return date.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'long',
  })
}

function dayKey(date?: Date): string {
  if (!date) return 'unknown'
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
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

function Thumb({
  item,
  resolveThumb,
  pathLabel,
  onOpen,
  onReconnect,
  onCopyPath,
}: {
  item: MediaItem
  resolveThumb: (item: MediaItem) => Promise<ThumbInfo | null>
  pathLabel: string
  onOpen: (item: MediaItem) => void
  onReconnect: (sourceId: string) => void
  onCopyPath: (item: MediaItem) => void
}) {
  const isVideo =
    item.kind === 'video' || item.kind === 'gopro' || item.kind === 'drone'
  const [thumb, setThumb] = useState<ThumbInfo | null>(null)
  const [failed, setFailed] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    let alive = true
    setThumb(null)
    setFailed(false)
    if (!item.available) return
    void resolveThumb(item).then(
      (t) => {
        if (!alive) return
        if (t) setThumb(t)
        else setFailed(true)
      },
      () => {
        if (alive) setFailed(true)
      },
    )
    return () => {
      alive = false
    }
  }, [item, resolveThumb])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const tip = pathLabel
    ? `${item.name}\n${pathLabel}`
    : item.name

  if (!item.available) {
    return (
      <button
        type="button"
        className="gallery-card gallery-card--offline"
        onClick={() => onReconnect(item.sourceId)}
        onContextMenu={onContextMenu}
        title={`${tip}\n(disk bağlı değil)`}
      >
        <span className="gallery-card__offline-icon" aria-hidden>
          ⛁
        </span>
        <span className={`gallery-card__badge kind-${item.kind}`}>
          {KIND_LABEL[item.kind]} · {item.locationMissing ? 'Konum yok' : 'GPS'}
        </span>
        <span className="gallery-card__label">
          {item.takenAt && (
            <span className="gallery-card__date">
              {formatDate(item.takenAt)} · {formatTime(item.takenAt)}
            </span>
          )}
          <span className="gallery-card__name">{item.name}</span>
        </span>
        {pathLabel && (
          <span className="gallery-card__path" title={pathLabel}>
            {pathLabel}
          </span>
        )}
        <span className="gallery-card__offline-note">Disk bağlı değil</span>
        {menu && (
          <PathMenu
            x={menu.x}
            y={menu.y}
            pathLabel={pathLabel}
            onCopy={() => {
              onCopyPath(item)
              setMenu(null)
            }}
          />
        )}
      </button>
    )
  }

  return (
    <button
      type="button"
      className="gallery-card"
      onClick={() => onOpen(item)}
      onContextMenu={onContextMenu}
      title={tip}
    >
      {thumb ? (
        <img
          className="gallery-card__media"
          src={thumb.url}
          alt={item.name}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : failed ? (
        <span className="gallery-card__fallback" aria-hidden>
          {isVideo ? '🎬' : '🖼'}
        </span>
      ) : (
        <span className="gallery-card__loading" aria-hidden />
      )}
      <span className={`gallery-card__badge kind-${item.kind}`}>
        {KIND_LABEL[item.kind]} · {item.locationMissing ? 'Konum yok' : 'GPS'}
      </span>
      <span className="gallery-card__label">
        {item.takenAt && (
          <span className="gallery-card__date">
            {formatDate(item.takenAt)} · {formatTime(item.takenAt)}
          </span>
        )}
        <span className="gallery-card__name">{item.name}</span>
      </span>
      {pathLabel && (
        <span className="gallery-card__path" title={pathLabel}>
          {pathLabel}
        </span>
      )}
      {isVideo && thumb?.durationSec !== undefined && (
        <span className="gallery-card__duration">
          {formatDuration(thumb.durationSec)}
        </span>
      )}
      {isVideo && <span className="gallery-card__play" aria-hidden />}
      {menu && (
        <PathMenu
          x={menu.x}
          y={menu.y}
          pathLabel={pathLabel}
          onCopy={() => {
            onCopyPath(item)
            setMenu(null)
          }}
        />
      )}
    </button>
  )
}

function PathMenu({
  x,
  y,
  pathLabel,
  onCopy,
}: {
  x: number
  y: number
  pathLabel: string
  onCopy: () => void
}) {
  return (
    <div
      className="gallery-menu"
      style={{ left: x, top: y }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="gallery-menu__path">{pathLabel || 'Yol bilinmiyor'}</p>
      <button
        type="button"
        className="gallery-menu__item"
        role="menuitem"
        onClick={onCopy}
        disabled={!pathLabel}
      >
        Yolu kopyala
      </button>
      <p className="gallery-menu__note">
        Tarayıcı klasörü Explorer’da açamaz; masaüstü uygulamada mümkün olur.
      </p>
    </div>
  )
}

export function MediaGallery({
  items,
  locationMode,
  resolveThumb,
  pathForItem,
  onOpen,
  onReconnect,
  onCopyPath,
}: MediaGalleryProps) {
  const [size, setSize] = useState<ThumbSize>(loadThumbSize)

  const changeSize = (next: ThumbSize) => {
    setSize(next)
    localStorage.setItem(SIZE_KEY, next)
  }

  if (items.length === 0) return null

  const shown = items.slice(0, MAX_VISIBLE)

  return (
    <section className="gallery">
      <header className="gallery__header">
        <div>
          <h2>
            {items.length} medya {locationMode === 'missing' ? '· Konumu bulunamayanlar' : '· GPS konumlu'}
            <span className="gallery__coords">bu alanda · en yeni üstte</span>
          </h2>
        </div>
        <div className="gallery__sizes" role="group" aria-label="Önizleme boyutu">
          {(['small', 'medium', 'large'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`gallery__size-btn ${size === s ? 'is-active' : ''}`}
              onClick={() => changeSize(s)}
              title={s === 'small' ? 'Küçük' : s === 'medium' ? 'Orta' : 'Büyük'}
            >
              <span
                className="gallery__size-icon"
                style={{ width: s === 'small' ? 8 : s === 'medium' ? 12 : 16 }}
                aria-hidden
              />
            </button>
          ))}
        </div>
      </header>
      <div
        className={`gallery__rail gallery__rail--${size}`}
        style={{ '--thumb-size': `${THUMB_PX[size]}px` } as CSSProperties}
      >
        {shown.map((item, index) => {
          const key = dayKey(item.takenAt)
          const previousKey = index > 0 ? dayKey(shown[index - 1].takenAt) : null
          return (
            <Fragment key={item.id}>
              {key !== previousKey && (
                <h3 className="gallery__day">
                  {item.takenAt
                    ? formatDayHeading(item.takenAt)
                    : 'Tarihi bilinmeyenler'}
                </h3>
              )}
              <Thumb
                item={item}
                resolveThumb={resolveThumb}
                pathLabel={pathForItem(item)}
                onOpen={onOpen}
                onReconnect={onReconnect}
                onCopyPath={onCopyPath}
              />
            </Fragment>
          )
        })}
      </div>
      {items.length > MAX_VISIBLE && (
        <p className="gallery__more">
          İlk {MAX_VISIBLE} gösteriliyor — daralmak için haritayı yakınlaştır.
        </p>
      )}
    </section>
  )
}
