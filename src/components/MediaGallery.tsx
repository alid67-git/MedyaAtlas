import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import type { MediaItem } from '../types'
import type { ThumbInfo } from '../App'
import { KIND_LABEL } from '../lib/media'

/** İlk dilim; “Daha fazla” ile artar. Lazy thumb ile binlerce satır da taşınabilir. */
const PAGE_SIZE = 120

type ThumbSize = 'small' | 'medium' | 'large'
export type GalleryScope = 'area' | 'all'

const THUMB_PX: Record<ThumbSize, number> = {
  small: 64,
  medium: 96,
  large: 148,
}

const SIZE_KEY = 'konumnerede-thumb-size'
const SCOPE_KEY = 'konumnerede-gallery-scope'

function loadThumbSize(): ThumbSize {
  const saved = localStorage.getItem(SIZE_KEY)
  return saved === 'small' || saved === 'medium' || saved === 'large'
    ? saved
    : 'medium'
}

export function loadGalleryScope(): GalleryScope {
  return localStorage.getItem(SCOPE_KEY) === 'all' ? 'all' : 'area'
}

interface MediaGalleryProps {
  items: MediaItem[]
  /** Kütüphanedeki GPS’li toplam (alan filtresinden bağımsız) */
  totalLocated: number
  locationMode: 'located' | 'missing'
  language: 'tr' | 'en'
  scope: GalleryScope
  onScopeChange: (scope: GalleryScope) => void
  selectedId?: string | null
  resolveThumb: (item: MediaItem) => Promise<ThumbInfo | null>
  pathForItem: (item: MediaItem) => string
  onSelect: (item: MediaItem) => void
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
  selected,
  resolveThumb,
  pathLabel,
  onSelect,
  onOpen,
  onReconnect,
  onCopyPath,
}: {
  item: MediaItem
  selected?: boolean
  resolveThumb: (item: MediaItem) => Promise<ThumbInfo | null>
  pathLabel: string
  onSelect: (item: MediaItem) => void
  onOpen: (item: MediaItem) => void
  onReconnect: (sourceId: string) => void
  onCopyPath: (item: MediaItem) => void
}) {
  const isVideo =
    item.kind === 'video' || item.kind === 'gopro' || item.kind === 'drone'
  const [thumb, setThumb] = useState<ThumbInfo | null>(null)
  const [failed, setFailed] = useState(false)
  const [nearView, setNearView] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const cardRef = useRef<HTMLButtonElement | null>(null)

  // Yalnızca görünen (veya yakındaki) kartlar için önizleme iste — kuyruk şişmesin
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNearView(true)
      },
      { root: el.closest('.gallery__rail'), rootMargin: '240px 0px', threshold: 0.01 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    let alive = true
    if (!nearView || !item.available) return
    setFailed(false)
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
  }, [nearView, item, resolveThumb])

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

  useEffect(() => {
    if (!selected || !cardRef.current) return
    cardRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])

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
        ref={cardRef}
        type="button"
        className={`gallery-card gallery-card--offline${selected ? ' is-selected' : ''}`}
        onClick={() => onReconnect(item.sourceId)}
        onContextMenu={onContextMenu}
        title={`${tip}\n(disk bağlı değil)`}
        aria-current={selected ? 'true' : undefined}
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
      ref={cardRef}
      type="button"
      className={`gallery-card${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(item)}
      onDoubleClick={() => onOpen(item)}
      onContextMenu={onContextMenu}
      title={`${tip}\nTek tık: haritada göster · Çift tık: aç`}
      aria-current={selected ? 'true' : undefined}
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
      onClick={(e) => e.stopPropagation()}
    >
      <p className="gallery-menu__path">{pathLabel || 'Yol bilinmiyor'}</p>
      <button
        type="button"
        className="gallery-menu__item"
        disabled={!pathLabel}
        onClick={onCopy}
      >
        Yolu kopyala
      </button>
      <p className="gallery-menu__note">
        Sağ tık menüsü
      </p>
    </div>
  )
}

export function MediaGallery({
  items,
  totalLocated,
  locationMode,
  language,
  scope,
  onScopeChange,
  selectedId,
  resolveThumb,
  pathForItem,
  onSelect,
  onOpen,
  onReconnect,
  onCopyPath,
}: MediaGalleryProps) {
  const [size, setSize] = useState<ThumbSize>(loadThumbSize)
  const [limit, setLimit] = useState(PAGE_SIZE)

  useEffect(() => {
    setLimit(PAGE_SIZE)
  }, [scope, locationMode])

  const changeSize = (next: ThumbSize) => {
    setSize(next)
    localStorage.setItem(SIZE_KEY, next)
  }

  const changeScope = (next: GalleryScope) => {
    localStorage.setItem(SCOPE_KEY, next)
    onScopeChange(next)
  }

  if (items.length === 0 && totalLocated === 0 && locationMode !== 'missing') return null
  if (items.length === 0) return null

  const shown = items.slice(0, limit)
  const remaining = items.length - shown.length

  return (
    <section className="gallery" lang={language}>
      <header className="gallery__header">
        <div>
          <h2>
            {items.length} medya{' '}
            {locationMode === 'missing' ? '· Konumu bulunamayanlar' : '· GPS konumlu'}
            <span className="gallery__coords">
              {locationMode === 'missing'
                ? 'en yeni üstte'
                : scope === 'area'
                  ? `bu alanda · kütüphane ${totalLocated}`
                  : `tümü · en yeni üstte`}
            </span>
          </h2>
        </div>
        <div className="gallery__tools">
          {locationMode !== 'missing' && (
            <div className="gallery__scope" role="group" aria-label="Galeri kapsamı">
              <button
                type="button"
                className={`gallery__scope-btn ${scope === 'area' ? 'is-active' : ''}`}
                onClick={() => changeScope('area')}
                title="Yalnızca haritada görünen alandaki medya"
              >
                Alan
              </button>
              <button
                type="button"
                className={`gallery__scope-btn ${scope === 'all' ? 'is-active' : ''}`}
                onClick={() => changeScope('all')}
                title="Kütüphanedeki tüm GPS’li medya"
              >
                Tümü
              </button>
            </div>
          )}
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
        </div>
      </header>
      <div
        className={`gallery__rail gallery__rail--${size}`}
        style={{ '--thumb-size': `${THUMB_PX[size]}px` } as CSSProperties}
      >
        {shown.map((item, index) => {
          const key = locationMode === 'missing' ? item.kind : dayKey(item.takenAt)
          const previousKey = index > 0
            ? (locationMode === 'missing' ? shown[index - 1].kind : dayKey(shown[index - 1].takenAt))
            : null
          return (
            <Fragment key={item.id}>
              {key !== previousKey && (
                <h3 className="gallery__day">
                  {locationMode === 'missing'
                    ? KIND_LABEL[item.kind]
                    : item.takenAt
                      ? formatDayHeading(item.takenAt)
                      : 'Tarihi bilinmeyenler'}
                </h3>
              )}
              <Thumb
                item={item}
                selected={selectedId === item.id}
                resolveThumb={resolveThumb}
                pathLabel={pathForItem(item)}
                onSelect={onSelect}
                onOpen={onOpen}
                onReconnect={onReconnect}
                onCopyPath={onCopyPath}
              />
            </Fragment>
          )
        })}
      </div>
      {remaining > 0 && (
        <button
          type="button"
          className="gallery__more"
          onClick={() => setLimit((n) => n + PAGE_SIZE)}
        >
          {remaining} medya daha göster
        </button>
      )}
    </section>
  )
}
