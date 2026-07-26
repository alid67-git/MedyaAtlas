import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WorldMap, type MapBounds } from './components/WorldMap'
import { MediaGallery, loadGalleryScope, type GalleryScope } from './components/MediaGallery'
import { Lightbox } from './components/Lightbox'
import {
  ScanAbortedError,
  detectKind,
  getExtension,
  groupByLocation,
  scanFiles,
} from './lib/media'
import {
  canPickFolder,
  discoverMediaFolders,
  ensureReadPermission,
  isSameFolder,
  isSourceAvailable,
  pickFolderHandle,
  readDirectFilesFromHandle,
  readFilesFromHandle,
  relativePathIfDescendant,
  resolveFileFromHandle,
} from './lib/pickFolder'
import {
  clearLibrary,
  deleteLibraryItems,
  deleteLibraryItemsBySource,
  deleteSource,
  getLastDirHandle,
  getLibraryItems,
  getSources,
  getThumb,
  putLibraryItems,
  putSource,
  putThumb,
  type LibraryItem,
} from './lib/cache'
import { generateThumb } from './lib/thumbs'
import type { MediaItem, MediaKind } from './types'

export interface ThumbInfo {
  url: string
  durationSec?: number
}
import './App.css'

/** Chrome'un dosya erişim hatalarını anlaşılır Türkçeye çevirir. */
function friendlyError(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : ''
  if (
    msg.includes('underlying filesystem') ||
    msg.includes('NoModificationAllowedError')
  ) {
    return (
      'Disk şu an okunamıyor (çıkarılmış, değişmiş ya da yazma korumalı olabilir). ' +
      'Diski çıkarıp yeniden tak ve tekrar dene; sorun sürerse kaynağı × ile kaldırıp klasörü yeniden ekle.'
    )
  }
  if (msg.includes('not allowed') || msg.includes('NotAllowedError')) {
    return 'Klasör erişim izni verilmedi. "Bağlan" düğmesiyle tekrar izin verebilirsin.'
  }
  return msg || fallback
}

function inBounds(lat: number, lon: number, b: MapBounds): boolean {
  if (lat < b.south || lat > b.north) return false
  // Tarih değişim çizgisi / dünya kopyaları için normalize et
  return [lon, lon + 360, lon - 360].some((l) => l >= b.west && l <= b.east)
}

function isNullIslandCoordinate(latitude: number, longitude: number): boolean {
  return Math.abs(latitude) < 0.01 && Math.abs(longitude) < 0.01
}

/** Yeniden taramada mtime değişse bile aynı dosya önizlemesi. id: kaynak|yol|boyut|mtime */
function stableThumbKey(item: MediaItem): string {
  const parts = item.id.split('|')
  if (parts.length >= 4) return parts.slice(0, -1).join('|')
  return `${item.sourceId}|${item.relativePath || item.name}`
}

/** Aynı anda en fazla N /api/thumb — tarayıcı + ffmpeg tıkanmasın. */
const THUMB_FETCH_MAX = 4
let thumbFetchActive = 0
const thumbFetchWait: Array<() => void> = []

async function acquireThumbFetch(): Promise<void> {
  if (thumbFetchActive >= THUMB_FETCH_MAX) {
    await new Promise<void>((resolve) => thumbFetchWait.push(resolve))
  }
  thumbFetchActive += 1
}

function releaseThumbFetch(): void {
  thumbFetchActive = Math.max(0, thumbFetchActive - 1)
  thumbFetchWait.shift()?.()
}

interface SourceUi {
  id: string
  label: string
  addedAt: number
  localPath?: string
  parentId?: string
  subPath?: string
  isAnchor?: boolean
  directOnly?: boolean
}

function drivePathFromLabel(label: string | undefined): string | undefined {
  if (!label) return undefined
  // "Elements SE (E:)" veya eski biçim
  const paren = /\(([A-Za-z]):\)/.exec(label)
  if (paren) return `${paren[1].toUpperCase()}:\\`
  // "E: (Elements SE)" — harf başta
  const start = /^([A-Za-z]):(?:\s|$|[\\/])/.exec(label.trim())
  if (start) return `${start[1].toUpperCase()}:\\`
  return undefined
}

/**
 * Çocuk kaynaklarda kayıtlı absolute localPath bayat kalabilir (sürücü harfi değişince).
 * parentId + subPath varsa çapa yolundan türet — offline sanılıp medyanın gizlenmesini önler.
 */
function localPathForSource(source: SourceUi, allSources: readonly SourceUi[]): string | undefined {
  if (source.parentId != null && source.subPath != null) {
    const anchor = allSources.find((item) => item.id === source.parentId)
    const rootSibling = allSources.find(
      (item) =>
        item.parentId === source.parentId && item.subPath === '' && item.localPath,
    )
    const inheritedRoot =
      anchor?.localPath ??
      rootSibling?.localPath ??
      (anchor ? drivePathFromLabel(anchor.label) : undefined)
    if (inheritedRoot) {
      const subPath = source.subPath.replaceAll('/', '\\').replace(/^\\+|\\+$/g, '')
      const root = inheritedRoot.replace(/[\\/]+$/, '')
      return subPath ? `${root}\\${subPath}` : `${root}\\`
    }
  }
  if (source.localPath) return source.localPath
  if (source.isAnchor) return drivePathFromLabel(source.label)
  return undefined
}

/** `F:\\`, `F:/`, `F:` → `F` */
function driveLetterOf(path: string | undefined): string | null {
  if (!path) return null
  const match = /^([A-Za-z]):/.exec(path.trim())
  return match ? match[1].toUpperCase() : null
}

function isDriveRootPath(path: string | undefined): boolean {
  return Boolean(path && /^[A-Za-z]:[\\/]*$/.test(path.trim()))
}

function normalizeWinPath(path: string): string {
  return path.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/** `inner` == `outer` veya `outer` altında. */
function pathEqualsOrInside(inner: string, outer: string): boolean {
  const a = normalizeWinPath(inner)
  const b = normalizeWinPath(outer)
  return a === b || a.startsWith(`${b}\\`)
}

/** Medyanın bağlı olduğu kaynak; çocuk yoksa çevrimiçi çapaya düş. */
function findSourceForItem(
  item: MediaItem,
  sources: readonly SourceUi[],
  grantedIds: ReadonlySet<string>,
  localOnlineIds: ReadonlySet<string>,
  localAvailabilityReady: boolean,
): SourceUi | undefined {
  const direct = sources.find((candidate) => candidate.id === item.sourceId)
  if (direct) return direct
  for (const anchor of sources) {
    if (!anchor.isAnchor) continue
    if (
      !isSourceOnline(
        anchor,
        sources,
        grantedIds,
        localOnlineIds,
        localAvailabilityReady,
      )
    ) {
      continue
    }
    return anchor
  }
  return undefined
}

/** Dosyanın bulunduğu klasörler (sürücü ağacı çocukları). */
function mediaFolderSubPaths(items: readonly MediaItem[]): string[] {
  const dirs = new Set<string>()
  let rootFiles = false
  for (const item of items) {
    const rel = (item.relativePath || item.name).replaceAll('\\', '/')
    const slash = rel.lastIndexOf('/')
    if (slash < 0) rootFiles = true
    else dirs.add(rel.slice(0, slash))
  }
  const list = [...dirs].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  if (rootFiles) list.unshift('')
  return list
}

function rewriteItemSource(
  item: MediaItem,
  newSourceId: string,
  newRel: string,
): MediaItem {
  const parts = item.id.split('|')
  const size = parts.length >= 3 ? parts[parts.length - 2] : '0'
  const mtime = parts.length >= 4 ? parts[parts.length - 1] : String(Date.now())
  return {
    ...item,
    sourceId: newSourceId,
    relativePath: newRel,
    id: `${newSourceId}|${newRel}|${size}|${mtime}`,
  }
}

/** Çapa altındaki çocuklara medyayı dağıt (göreli yol + sourceId). */
function remapItemsToDriveChildren(
  items: readonly MediaItem[],
  anchorId: string,
  children: readonly { id: string; subPath: string }[],
): MediaItem[] {
  const sorted = [...children].sort((a, b) => b.subPath.length - a.subPath.length)
  return items.map((item) => {
    if (item.sourceId !== anchorId) return item
    const rel = (item.relativePath || item.name).replaceAll('\\', '/')
    for (const child of sorted) {
      if (child.subPath === '') {
        if (!rel.includes('/')) return rewriteItemSource(item, child.id, rel)
        continue
      }
      if (rel === child.subPath || rel.startsWith(`${child.subPath}/`)) {
        const newRel =
          rel === child.subPath ? item.name : rel.slice(child.subPath.length + 1)
        return rewriteItemSource(item, child.id, newRel)
      }
    }
    return item
  })
}

/** Yerel yol varsa disk erişimi; yoksa File System Access izni. */
function isSourceOnline(
  source: SourceUi,
  allSources: readonly SourceUi[],
  grantedIds: ReadonlySet<string>,
  localOnlineIds: ReadonlySet<string>,
  localAvailabilityReady: boolean,
): boolean {
  const path = localPathForSource(source, allSources)
  if (path) {
    // Availability henüz gelmediyse yollu kaynağı çevrimdışı sayma
    if (!localAvailabilityReady) return true
    if (localOnlineIds.has(source.id)) return true
    // Alt klasör yolu başarısız olsa bile sürücü çapası online ise medyayı gizleme
    if (source.parentId) {
      const parent = allSources.find((item) => item.id === source.parentId)
      if (
        parent &&
        isSourceOnline(
          parent,
          allSources,
          grantedIds,
          localOnlineIds,
          localAvailabilityReady,
        )
      ) {
        return true
      }
    }
    return false
  }
  return grantedIds.has(source.id)
}

/** Tarama sırasında bilinen Windows yolu; Explorer / VLC için. */
function windowsPathForItem(
  item: MediaItem,
  allSources: readonly SourceUi[],
): string | undefined {
  const raw = item.relativePath || item.name
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    return raw.replace(/\//g, '\\')
  }
  const source = allSources.find((candidate) => candidate.id === item.sourceId)
  if (!source) return undefined
  const root = localPathForSource(source, allSources)
  if (!root) return undefined
  const rel = raw.replace(/\//g, '\\').replace(/^\\+/, '')
  if (!rel) return root.replace(/[\\/]+$/, '')
  return `${root.replace(/[\\/]+$/, '')}\\${rel}`
}

interface SourceTreeNode {
  /** Çapa göreli yol; kök için ''. */
  path: string
  name: string
  source?: SourceUi
  children: SourceTreeNode[]
}

function buildSourceTree(children: SourceUi[]): SourceTreeNode[] {
  const root: SourceTreeNode = { path: '', name: '', children: [] }

  const ensure = (parts: string[]): SourceTreeNode => {
    let node = root
    let path = ''
    for (const part of parts) {
      path = path ? `${path}/${part}` : part
      let child = node.children.find((c) => c.name === part)
      if (!child) {
        child = { path, name: part, children: [] }
        node.children.push(child)
      }
      node = child
    }
    return node
  }

  for (const source of children) {
    const raw = source.subPath?.trim() ?? ''
    if (!raw) {
      root.children.push({
        path: '',
        name: '(kök)',
        source,
        children: [],
      })
      continue
    }
    const node = ensure(raw.split('/').filter(Boolean))
    node.source = source
  }

  const sortRec = (nodes: SourceTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    for (const n of nodes) sortRec(n.children)
  }
  sortRec(root.children)
  return root.children
}

function collectDescendantSourceIds(node: SourceTreeNode): string[] {
  const ids: string[] = []
  if (node.source) ids.push(node.source.id)
  for (const child of node.children) {
    ids.push(...collectDescendantSourceIds(child))
  }
  return ids
}

/** Sürücü ağacını (ara klasörler dahil) açık göstermek için expand anahtarları. */
function expandKeysForDriveChildren(
  anchorId: string,
  children: readonly SourceUi[],
): string[] {
  const keys = new Set<string>([`${anchorId}::`])
  for (const child of children) {
    const parts = (child.subPath || '').split('/').filter(Boolean)
    let path = ''
    for (const part of parts) {
      path = path ? `${path}/${part}` : part
      keys.add(`${anchorId}::${path}`)
    }
  }
  return [...keys]
}

const TRANSIENT_PREFIX = 'transient-'
const FILTER_KEY = 'konumnerede-media-filters'
const HIDDEN_SOURCES_KEY = 'konumnerede-hidden-sources'
const ALL_KINDS: MediaKind[] = ['photo', 'video', 'gopro', 'drone']

function loadHiddenSources(): Set<string> {
  try {
    const saved = JSON.parse(
      localStorage.getItem(HIDDEN_SOURCES_KEY) ?? '[]',
    ) as unknown
    if (Array.isArray(saved)) return new Set(saved.filter((v) => typeof v === 'string'))
  } catch {
    // Varsayılana düş
  }
  return new Set()
}

function loadFilters(): Set<MediaKind> {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_KEY) ?? '[]') as unknown
    if (Array.isArray(saved)) {
      const valid = saved.filter((v): v is MediaKind =>
        ALL_KINDS.includes(v as MediaKind),
      )
      if (valid.length > 0) return new Set(valid)
    }
  } catch {
    // Varsayılanlara düş
  }
  return new Set(ALL_KINDS)
}

function acceptsFileName(name: string, kinds: ReadonlySet<MediaKind>): boolean {
  if (/\.lrv$/i.test(name)) return false
  if (getExtension(name) === 'xmp' || getExtension(name) === 'srt') return true
  const kind = detectKind(name)
  return kind !== null && kinds.has(kind)
}

/** Kaynak keşfi, ekrandaki tür filtresinden bağımsız tüm desteklenen medyayı görür. */
function isSupportedMediaFileName(name: string): boolean {
  if (/\.lrv$/i.test(name)) return false
  if (getExtension(name) === 'xmp' || getExtension(name) === 'srt') return true
  return detectKind(name) !== null
}

async function forEachWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < values.length) {
      const value = values[nextIndex]
      nextIndex += 1
      await task(value)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  )
}

function toLibraryItem(item: MediaItem): LibraryItem {
  return {
    id: item.id,
    sourceId: item.sourceId,
    relativePath: item.relativePath,
    name: item.name,
    kind: item.kind,
    latitude: item.latitude,
    longitude: item.longitude,
    takenAt: item.takenAt ? item.takenAt.getTime() : undefined,
    width: item.width,
    height: item.height,
    locationMissing: item.locationMissing,
  }
}

export default function App() {
  const [items, setItems] = useState<MediaItem[]>([])
  const [showLocationMissing, setShowLocationMissing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [driveDialogOpen, setDriveDialogOpen] = useState(false)
  const [drivePath, setDrivePath] = useState('')
  const [driveLabel, setDriveLabel] = useState('')
  const [availableDrives, setAvailableDrives] = useState<
    Array<{ letter: string; path: string; label: string; volumeName: string | null }>
  >([])
  const [drivesLoading, setDrivesLoading] = useState(false)
  const [drivesError, setDrivesError] = useState<string | null>(null)
  const [language, setLanguage] = useState<'tr' | 'en'>(() =>
    localStorage.getItem('mediaatlas-language') === 'en' ? 'en' : 'tr',
  )
  const [localOnlineIds, setLocalOnlineIds] = useState<Set<string>>(new Set())
  const [localAvailabilityReady, setLocalAvailabilityReady] = useState(false)
  const [enabledKinds, setEnabledKinds] = useState<Set<MediaKind>>(loadFilters)
  const [sources, setSources] = useState<SourceUi[]>([])
  const [grantedIds, setGrantedIds] = useState<Set<string>>(new Set())
  const [hiddenSourceIds, setHiddenSourceIds] =
    useState<Set<string>>(loadHiddenSources)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [typeMenuLocation, setTypeMenuLocation] = useState<'located' | 'missing' | null>(null)
  /** Açık ağaç düğümleri: `${anchorId}::${path}` */
  const [expandedTree, setExpandedTree] = useState<Set<string>>(() => new Set())
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null)
  const [galleryScope, setGalleryScope] = useState<GalleryScope>(() => loadGalleryScope())
  const [viewer, setViewer] = useState<MediaItem | null>(null)
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null)
  // Kaynak başına eşzamanlı tarama ilerlemesi
  const [scans, setScans] = useState<Map<string, { done: number; total: number; located?: number; missing?: number }>>(
    () => new Map(),
  )
  const [skipped, setSkipped] = useState(0)
  const [skippedNames, setSkippedNames] = useState<string[]>([])
  const [error, setErrorState] = useState<string | null>(null)
  const [toastKind, setToastKind] = useState<'error' | 'info'>('error')
  const errorTimerRef = useRef<number | null>(null)

  const setError = useCallback((message: string | null, kind: 'error' | 'info' = 'error') => {
    if (errorTimerRef.current != null) {
      window.clearTimeout(errorTimerRef.current)
      errorTimerRef.current = null
    }
    setErrorState(message)
    setToastKind(kind)
    if (message) {
      errorTimerRef.current = window.setTimeout(() => {
        setErrorState(null)
        errorTimerRef.current = null
      }, 2500)
    }
  }, [])

  const [cachedCount, setCachedCount] = useState(0)
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null)

  const busy = scans.size > 0
  const folderInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sourcesMenuRef = useRef<HTMLDivElement>(null)
  const typesMenuRef = useRef<HTMLDivElement>(null)
  const scanControllersRef = useRef<Map<string, AbortController>>(new Map())
  const scanJobIdsRef = useRef<Map<string, string>>(new Map())
  const handlesRef = useRef<Map<string, FileSystemDirectoryHandle>>(new Map())
  const fileMapRef = useRef<Map<string, File>>(new Map())
  const urlCacheRef = useRef<Map<string, string>>(new Map())
  const thumbCacheRef = useRef<Map<string, ThumbInfo | null>>(new Map())
  const thumbPendingRef = useRef<Map<string, Promise<ThumbInfo | null>>>(new Map())
  const itemsRef = useRef<MediaItem[]>([])
  const enabledKindsRef = useRef(enabledKinds)
  const sourcesRef = useRef<SourceUi[]>([])
  itemsRef.current = items
  enabledKindsRef.current = enabledKinds
  sourcesRef.current = sources

  useEffect(() => {
    let alive = true
    const check = async () => {
      const localSources = sources
        .map((source) => ({ id: source.id, path: localPathForSource(source, sources) }))
        .filter((source): source is { id: string; path: string } => Boolean(source.path))
      if (localSources.length === 0) {
        if (alive) {
          setLocalOnlineIds(new Set())
          setLocalAvailabilityReady(false)
        }
        return
      }
      try {
        const response = await fetch('/api/availability', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sources: localSources }),
        })
        const data = await response.json() as { available?: string[] }
        if (alive && response.ok) {
          setLocalOnlineIds(new Set(data.available ?? []))
          setLocalAvailabilityReady(true)
        }
      } catch {
        // Eski yerel hizmet çalışıyorsa medyayı gizleme; tarayıcının mevcut
        // bağlantı bilgisini kullanmaya devam et.
        if (alive) setLocalAvailabilityReady(false)
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), 5000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [sources])

  useEffect(() => {
    if (!driveDialogOpen) return
    let alive = true
    setDrivesLoading(true)
    setDrivesError(null)
    void (async () => {
      try {
        const response = await fetch('/api/drives')
        const data = (await response.json()) as {
          error?: string
          drives?: Array<{ letter: string; path: string; label: string; volumeName: string | null }>
        }
        if (!alive) return
        if (!response.ok) throw new Error(data.error || 'Sürücüler okunamadı.')
        const drives = data.drives ?? []
        setAvailableDrives(drives)

        const addedLetters = new Set<string>()
        for (const source of sourcesRef.current) {
          const root = source.localPath ?? localPathForSource(source, sourcesRef.current)
          if (isDriveRootPath(root) || source.isAnchor) {
            const letter = driveLetterOf(root) ?? driveLetterOf(source.localPath)
            if (letter) addedLetters.add(letter)
          }
        }

        const selectable = drives.filter((d) => !addedLetters.has(d.letter.toUpperCase()))
        const preferred =
          selectable.find((d) => d.path.toUpperCase() === drivePath.toUpperCase())
          ?? selectable.find((d) => d.letter !== 'C')
          ?? selectable[0]
          ?? null

        if (preferred) {
          setDrivePath(preferred.path)
          setDriveLabel(preferred.label)
        } else {
          setDrivePath('')
          setDriveLabel('')
        }
      } catch {
        if (!alive) return
        setAvailableDrives([])
        setDrivesError(
          'Sürücü listesi alınamadı. Yerel servisin (baslat.bat) açık olduğundan emin olun.',
        )
      } finally {
        if (alive) setDrivesLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [driveDialogOpen])

  const addedDriveLetters = useMemo(() => {
    const letters = new Set<string>()
    for (const source of sources) {
      const root = source.localPath ?? localPathForSource(source, sources)
      if (isDriveRootPath(root) || (source.isAnchor && root)) {
        const letter = driveLetterOf(root)
        if (letter) letters.add(letter)
      } else if (isDriveRootPath(source.localPath)) {
        const letter = driveLetterOf(source.localPath)
        if (letter) letters.add(letter)
      }
    }
    return letters
  }, [sources])

  // Kaynak erişimi + seçili tür ve kaynak filtreleri
  const availableItems = useMemo(
    () => {
      return items
        .filter(
          (it) =>
            enabledKinds.has(it.kind) &&
            !/\.lrv$/i.test(it.name) &&
            !hiddenSourceIds.has(it.sourceId) &&
            (() => {
              const source = findSourceForItem(
                it,
                sources,
                grantedIds,
                localOnlineIds,
                localAvailabilityReady,
              )
              if (!source) return false
              return isSourceOnline(
                source,
                sources,
                grantedIds,
                localOnlineIds,
                localAvailabilityReady,
              )
            })(),
        )
        .map((it) => {
          const source = findSourceForItem(
            it,
            sources,
            grantedIds,
            localOnlineIds,
            localAvailabilityReady,
          )
          const online = source
            ? isSourceOnline(
                source,
                sources,
                grantedIds,
                localOnlineIds,
                localAvailabilityReady,
              )
            : false
          return { ...it, available: online }
        })
    },
    [items, grantedIds, enabledKinds, hiddenSourceIds, sources, localOnlineIds, localAvailabilityReady],
  )
  const clusters = useMemo(
    () => showLocationMissing ? [] : groupByLocation(availableItems.filter((item) => !item.locationMissing), 24),
    [availableItems, showLocationMissing],
  )
  const locationCount = useMemo(
    () => new Set(
      availableItems
        .filter((item) => !item.locationMissing)
        .map((item) => `${item.latitude.toFixed(5)},${item.longitude.toFixed(5)}`),
    ).size,
    [availableItems],
  )
  // Kaynak başına kütüphanedeki medya sayısı (harita alanına bağlı değil)
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const it of availableItems) {
      counts.set(it.sourceId, (counts.get(it.sourceId) ?? 0) + 1)
    }
    return counts
  }, [availableItems])

  // Galeri: alan veya tüm kütüphane; en yeni üstte
  const galleryItems = useMemo(() => {
    if (showLocationMissing) return availableItems.filter((item) => item.locationMissing)
    const located = availableItems.filter((i) => !i.locationMissing)
    const list =
      galleryScope === 'all' || !mapBounds
        ? located
        : located.filter((i) => inBounds(i.latitude, i.longitude, mapBounds))
    return list.sort((a, b) => {
      if (a.takenAt && b.takenAt) return b.takenAt.getTime() - a.takenAt.getTime()
      if (a.takenAt) return -1
      if (b.takenAt) return 1
      return a.name.localeCompare(b.name)
    })
  }, [availableItems, mapBounds, showLocationMissing, galleryScope])

  const locatedCount = useMemo(
    () => availableItems.filter((i) => !i.locationMissing).length,
    [availableItems],
  )

  // Harita rozeti: her zaman mevcut görünüm
  const visibleInArea = useMemo(() => {
    if (!mapBounds) return 0
    return availableItems.filter(
      (i) => !i.locationMissing && inBounds(i.latitude, i.longitude, mapBounds),
    ).length
  }, [availableItems, mapBounds])

  const focusedItem = useMemo(
    () =>
      focusedItemId
        ? availableItems.find((item) => item.id === focusedItemId) ?? null
        : null,
    [availableItems, focusedItemId],
  )

  const focusPoint = useMemo(() => {
    if (!focusedItem || focusedItem.locationMissing) return null
    return {
      id: focusedItem.id,
      latitude: focusedItem.latitude,
      longitude: focusedItem.longitude,
    }
  }, [focusedItem])

  useEffect(() => {
    const cache = urlCacheRef.current
    const thumbCache = thumbCacheRef.current
    const controllers = scanControllersRef.current
    return () => {
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      for (const url of cache.values()) URL.revokeObjectURL(url)
      cache.clear()
      for (const info of thumbCache.values()) {
        if (info) URL.revokeObjectURL(info.url)
      }
      thumbCache.clear()
    }
  }, [])

  useEffect(() => {
    const input = folderInputRef.current
    if (input) {
      input.setAttribute('webkitdirectory', '')
      input.setAttribute('directory', '')
    }
  }, [])

  // Tür menüsü: dışarı tıklayınca kapan
  useEffect(() => {
    if (!typeMenuLocation) return
    const onDown = (e: MouseEvent) => {
      if (!typesMenuRef.current?.contains(e.target as Node)) {
        setTypeMenuLocation(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [typeMenuLocation])

  useEffect(() => {
    if (!sourcesOpen) return
    const onDown = (e: MouseEvent) => {
      if (!sourcesMenuRef.current?.contains(e.target as Node)) setSourcesOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [sourcesOpen])

  // Açılışta kalıcı kütüphaneyi ve kaynakları yükle (tarama yok)
  useEffect(() => {
    void (async () => {
      const [srcs, rawLib] = await Promise.all([getSources(), getLibraryItems()])

      // LRV'ler değerlendirme dışı: eski kayıtları da temizle
       const invalidItems = rawLib.filter((l) => l.name.toLowerCase().endsWith('.lrv'))
       if (invalidItems.length > 0) {
         await deleteLibraryItems(invalidItems.map((l) => l.id))
       }
       const lib = rawLib.filter(
         (l) =>
            !l.name.toLowerCase().endsWith('.lrv'),
       )

      // Tarihsiz eski kayıtları onar: kayıt kimliğinin son parçası
      // dosyanın değiştirilme zamanıdır (sourceId|yol|boyut|lastModified)
      const repaired: LibraryItem[] = []
      for (const l of lib) {
        if (l.takenAt) continue
        const lastModified = Number(l.id.slice(l.id.lastIndexOf('|') + 1))
        if (Number.isFinite(lastModified) && lastModified > 0) {
          l.takenAt = lastModified
          repaired.push(l)
        }
      }
      if (repaired.length > 0) {
        await putLibraryItems(repaired)
      }

      // Eski sürümden kalan "son klasör" kaydını yeni kaynak modeline taşı
      if (srcs.length === 0) {
        const legacy = await getLastDirHandle()
        if (legacy) {
          const record = {
            id: `src-legacy-${Date.now()}`,
            label: legacy.name,
            addedAt: Date.now(),
            handle: legacy,
          }
          await putSource(record)
          srcs.push(record)
          setError(
            `"${legacy.name}" klasörü önceki oturumdan aktarıldı. ` +
              'İşaretleri geri getirmek için üstteki çipten "Bağlan"a tıkla; ' +
              'önbellek sayesinde hızlı yüklenecek.',
          )
        }
      }

      const granted = new Set<string>()
      await Promise.all(
        srcs.map(async (s) => {
          if (!s.handle) return
          handlesRef.current.set(s.id, s.handle)
          if (await isSourceAvailable(s.handle)) granted.add(s.id)
        }),
      )
      const loaded: MediaItem[] = lib.map((l) => ({
        id: l.id,
        name: l.name,
        relativePath: l.relativePath,
        sourceId: l.sourceId,
        kind: l.kind,
        available: granted.has(l.sourceId),
        latitude: l.latitude,
        longitude: l.longitude,
        takenAt: l.takenAt ? new Date(l.takenAt) : undefined,
        width: l.width,
        height: l.height,
        // Eski kayıtlarda bayrak yoktu; 0,0 koordinatı konum yok demektir.
        locationMissing: l.locationMissing ?? isNullIslandCoordinate(l.latitude, l.longitude),
      }))

      // Eski sürücü kayıtları: medya çapa id'sinde kalmış → alt klasör çocuklarına böl
      let uiSources: SourceUi[] = srcs
        .map((s) => ({
          id: s.id,
          label: s.label,
          addedAt: s.addedAt,
          parentId: s.parentId,
          subPath: s.subPath,
          localPath: s.localPath,
          isAnchor: s.isAnchor ?? isDriveRootPath(s.localPath),
          directOnly: s.directOnly,
        }))
        .sort((a, b) => a.addedAt - b.addedAt)

      let uiItems = loaded
      for (const anchor of [...uiSources]) {
        if (!anchor.isAnchor && !isDriveRootPath(anchor.localPath)) continue
        const rootPath = anchor.localPath
        if (!rootPath || !isDriveRootPath(rootPath)) continue
        const onAnchor = uiItems.filter((i) => i.sourceId === anchor.id)
        if (onAnchor.length === 0) continue

        const folderPaths = mediaFolderSubPaths(onAnchor)
        const existingKids = uiSources.filter(
          (s) => s.parentId === anchor.id && s.subPath != null,
        )
        const bySub = new Map(existingKids.map((s) => [s.subPath as string, s]))
        const childSources: SourceUi[] = []
        for (const subPath of folderPaths) {
          const childPath =
            subPath === ''
              ? `${rootPath.replace(/[\\/]+$/, '')}\\`
              : `${rootPath.replace(/[\\/]+$/, '')}\\${subPath.replaceAll('/', '\\')}`
          const prev = bySub.get(subPath)
          if (prev) {
            childSources.push({ ...prev, localPath: childPath, isAnchor: false })
            continue
          }
          childSources.push({
            id: `src-mig-${anchor.id}-${childSources.length}-${Date.now().toString(36)}`,
            label:
              subPath === ''
                ? '(kök)'
                : subPath.split('/').filter(Boolean).pop() || subPath,
            addedAt: Date.now(),
            localPath: childPath,
            parentId: anchor.id,
            subPath,
            directOnly: true,
          })
        }

        const remapped = remapItemsToDriveChildren(
          onAnchor,
          anchor.id,
          childSources.map((c) => ({ id: c.id, subPath: c.subPath ?? '' })),
        )
        uiItems = [
          ...uiItems.filter((i) => i.sourceId !== anchor.id),
          ...remapped,
        ]
        uiSources = [
          ...uiSources.filter(
            (s) =>
              s.id === anchor.id ||
              s.parentId !== anchor.id ||
              childSources.some((c) => c.id === s.id),
          ),
          ...childSources.filter((c) => !bySub.has(c.subPath ?? '')),
        ]
        // Güncellenmiş localPath'leri yaz
        uiSources = uiSources.map((s) => {
          const fresh = childSources.find((c) => c.id === s.id)
          return fresh ? { ...s, localPath: fresh.localPath } : s
        })

        await deleteLibraryItemsBySource(anchor.id)
        for (const child of childSources) {
          await putSource({
            id: child.id,
            label: child.label,
            addedAt: child.addedAt,
            localPath: child.localPath,
            parentId: anchor.id,
            subPath: child.subPath,
            directOnly: true,
          })
        }
        await putSource({
          id: anchor.id,
          label: anchor.label,
          addedAt: anchor.addedAt,
          localPath: anchor.localPath,
          isAnchor: true,
        })
        await putLibraryItems(remapped.map(toLibraryItem))
        for (const child of childSources) granted.add(child.id)
      }

      setSources(uiSources)
      // Sürücü alt klasörleri görünsün
      const expand = new Set<string>()
      for (const anchor of uiSources.filter((s) => s.isAnchor)) {
        const kids = uiSources.filter((s) => s.parentId === anchor.id)
        for (const key of expandKeysForDriveChildren(anchor.id, kids)) {
          expand.add(key)
        }
      }
      setExpandedTree(expand)
      setSourcesOpen(false)
      setGrantedIds(granted)
      setItems(uiItems)
    })()
  }, [])

  const cancelScan = useCallback(() => {
    for (const controller of scanControllersRef.current.values()) {
      controller.abort()
    }
    scanControllersRef.current.clear()
    for (const jobId of scanJobIdsRef.current.values()) {
      void fetch(`/api/scan/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }).catch(
        () => {},
      )
    }
    scanJobIdsRef.current.clear()
    setScans(new Map())
    setError('Tarama iptal edildi.', 'info')
  }, [])

  const toggleSourceVisible = useCallback((id: string) => {
    setHiddenSourceIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(HIDDEN_SOURCES_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  const toggleKind = useCallback((kind: MediaKind) => {
    setEnabledKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) {
        // Harita ve tarama hiçbir tür seçilmeden bırakılamaz.
        if (next.size === 1) return current
        next.delete(kind)
      } else {
        next.add(kind)
      }
      localStorage.setItem(FILTER_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  const resolveFile = useCallback(
    async (item: MediaItem): Promise<File | null> => {
      let file = fileMapRef.current.get(item.id)
      if (!file) {
        const handle = handlesRef.current.get(item.sourceId)
        if (!handle) return null
        const ok = await ensureReadPermission(handle, true)
        if (!ok) return null
        const resolved = await resolveFileFromHandle(handle, item.relativePath)
        if (!resolved) return null
        file = resolved
        fileMapRef.current.set(item.id, file)
      }
      return file
    },
    [],
  )

  const resolveUrl = useCallback(
    async (item: MediaItem): Promise<string | null> => {
      const cached = urlCacheRef.current.get(item.id)
      if (cached) return cached

      const toDirect = (url: string) =>
        url.startsWith('/api/') ? `http://127.0.0.1:5174${url}` : url

      const source = sourcesRef.current.find((candidate) => candidate.id === item.sourceId)
      const rootPath = source ? localPathForSource(source, sourcesRef.current) : undefined
      if (rootPath) {
        try {
          const response = await fetch('/api/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: item.id,
              rootPath,
              relativePath: item.relativePath || item.name,
            }),
          })
          const data = (await response.json()) as { url?: string }
          if (response.ok && data.url) {
            const mediaUrl = toDirect(data.url)
            urlCacheRef.current.set(item.id, mediaUrl)
            return mediaUrl
          }
        } catch { /* tarayıcı dosya yolu çözümüne düş */ }
      }

      // Blob / http dışı sabit url'ler (eski tarayıcı akışı)
      if (item.url && !item.url.startsWith('/api/media/')) {
        urlCacheRef.current.set(item.id, item.url)
        return item.url
      }

      const file = await resolveFile(item)
      if (!file) {
        if (item.url) {
          const fallback = toDirect(item.url)
          urlCacheRef.current.set(item.id, fallback)
          return fallback
        }
        return null
      }
      const url = URL.createObjectURL(file)
      urlCacheRef.current.set(item.id, url)
      return url
    },
    [resolveFile],
  )

  const resolveCompatibleVideoUrl = useCallback(
    async (
      item: MediaItem,
      _onProgress?: (percent: number | null) => void,
    ): Promise<string | null> => {
      const source = sourcesRef.current.find((candidate) => candidate.id === item.sourceId)
      const rootPath = source ? localPathForSource(source, sourcesRef.current) : undefined
      if (!rootPath) return null
      try {
        const response = await fetch('/api/transcode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: item.id,
            rootPath,
            relativePath: item.relativePath || item.name,
          }),
        })
        const data = (await response.json()) as { url?: string }
        if (!response.ok || !data.url) return null
        return data.url.startsWith('/api/')
          ? `http://127.0.0.1:5174${data.url}`
          : data.url
      } catch {
        return null
      }
    },
    [],
  )

  const revealInFolder = useCallback(
    async (item: MediaItem): Promise<boolean> => {
      try {
        const path = windowsPathForItem(item, sourcesRef.current)
        const source = sourcesRef.current.find((s) => s.id === item.sourceId)
        const response = await fetch('/api/reveal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path,
            id: item.id,
            rootPath: source
              ? localPathForSource(source, sourcesRef.current)
              : undefined,
            relativePath: item.relativePath || item.name,
          }),
        })
        return response.ok
      } catch {
        return false
      }
    },
    [],
  )

  const playExternally = useCallback(
    async (
      item: MediaItem,
      player: 'system' | 'vlc' = 'vlc',
    ): Promise<boolean> => {
      try {
        const path = windowsPathForItem(item, sourcesRef.current)
        const source = sourcesRef.current.find((s) => s.id === item.sourceId)
        const response = await fetch('/api/play', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path,
            id: item.id,
            player,
            rootPath: source
              ? localPathForSource(source, sourcesRef.current)
              : undefined,
            relativePath: item.relativePath || item.name,
          }),
        })
        return response.ok
      } catch {
        return false
      }
    },
    [],
  )

  const previewEmbed = useCallback(
    async (
      item: MediaItem,
      bounds: { x: number; y: number; width: number; height: number; viewport?: boolean },
    ): Promise<boolean> => {
      try {
        const path = windowsPathForItem(item, sourcesRef.current)
        const source = sourcesRef.current.find((s) => s.id === item.sourceId)
        const response = await fetch('/api/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: item.id,
            path,
            rootPath: source
              ? localPathForSource(source, sourcesRef.current)
              : undefined,
            relativePath: item.relativePath || item.name,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            viewport: bounds.viewport !== false,
          }),
        })
        const data = (await response.json()) as { ok?: boolean; error?: string }
        return Boolean(response.ok && data?.ok)
      } catch {
        return false
      }
    },
    [],
  )

  const updatePreviewBounds = useCallback(
    async (bounds: {
      x: number
      y: number
      width: number
      height: number
      viewport?: boolean
    }) => {
      try {
        await fetch('/api/preview/bounds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            viewport: bounds.viewport !== false,
          }),
        })
      } catch {
        /* yok say */
      }
    },
    [],
  )

  const stopPreview = useCallback(async () => {
    try {
      await fetch('/api/preview/stop', { method: 'POST' })
    } catch {
      /* yok say */
    }
  }, [])

  /**
   * Küçük önizleme: önce bellek, sonra IndexedDB; yoksa dosyadan bir kez
   * üretilir ve kalıcı saklanır. Galeri asla tam boy video/foto açmaz.
   */
  const pathForItem = useCallback(
    (item: MediaItem): string => {
      const source = sourcesRef.current.find((s) => s.id === item.sourceId)
      if (!source) return item.relativePath || item.name

      const parts: string[] = []
      if (source.parentId) {
        const drive = sourcesRef.current.find((s) => s.id === source.parentId)
        if (drive) parts.push(drive.label)
      } else if (source.isAnchor) {
        parts.push(source.label)
      } else {
        parts.push(source.label)
      }

      if (source.subPath) parts.push(...source.subPath.split('/').filter(Boolean))

      const rel = item.relativePath || item.name
      const relParts = rel.split('/').filter(Boolean)
      // Klasör adı zaten subPath'te varsa dosya adını ekle; göreli yol klasör+dosya ise ekle
      if (relParts.length > 0) {
        const last = relParts[relParts.length - 1]
        if (relParts.length === 1) {
          parts.push(last)
        } else {
          parts.push(...relParts)
        }
      }

      // Yinelenen ardışık parçaları sadeleştir
      const clean: string[] = []
      for (const p of parts) {
        if (clean[clean.length - 1] !== p) clean.push(p)
      }
      return clean.join(' › ')
    },
    [],
  )

  const copyItemPath = useCallback(
    (item: MediaItem) => {
      const text = pathForItem(item)
      void navigator.clipboard.writeText(text).then(
        () => setError(`Yol kopyalandı: ${text}`, 'info'),
        () => setError('Yol kopyalanamadı.'),
      )
    },
    [pathForItem],
  )

  /**
   * Küçük önizleme: bellek → IndexedDB → masaüstü /api/thumb → tarayıcı dosyası.
   * Disk önbelleği kararlı anahtarla (mtime yok) — her taramada yeniden üretilmez.
   */
  const resolveThumb = useCallback(
    async (item: MediaItem): Promise<ThumbInfo | null> => {
      const cacheKey = stableThumbKey(item)
      const inMemory = thumbCacheRef.current.get(cacheKey)
      if (inMemory) return inMemory

      const pending = thumbPendingRef.current.get(cacheKey)
      if (pending) return pending

      const toDirect = (url: string) =>
        url.startsWith('/api/') ? `http://127.0.0.1:5174${url}` : url

      const task = (async (): Promise<ThumbInfo | null> => {
        const stored = await getThumb(cacheKey)
        if (stored) {
          const info: ThumbInfo = {
            url: URL.createObjectURL(stored.blob),
            durationSec: stored.durationSec,
          }
          thumbCacheRef.current.set(cacheKey, info)
          return info
        }

        const source = sourcesRef.current.find((candidate) => candidate.id === item.sourceId)
        const rootPath = source
          ? localPathForSource(source, sourcesRef.current)
          : undefined

        if (rootPath && item.kind === 'photo') {
          const directUrl = await resolveUrl(item)
          if (directUrl) {
            const info = { url: directUrl }
            thumbCacheRef.current.set(cacheKey, info)
            return info
          }
        }

        if (rootPath) {
          await acquireThumbFetch()
          try {
            const response = await fetch('/api/thumb', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: item.id,
                rootPath,
                relativePath: item.relativePath || item.name,
              }),
            })
            const data = (await response.json()) as { url?: string; durationSec?: number; cached?: boolean }
            if (response.ok && data.url) {
              const info: ThumbInfo = {
                url: toDirect(data.url),
                durationSec: data.durationSec,
              }
              thumbCacheRef.current.set(cacheKey, info)
              return info
            }
          } catch { /* tarayıcı yoluna düş */ }
          finally {
            releaseThumbFetch()
          }
        }

        if (item.url && item.kind === 'photo') {
          const info = { url: toDirect(item.url) }
          thumbCacheRef.current.set(cacheKey, info)
          return info
        }

        const directUrl = item.kind === 'photo' ? await resolveUrl(item) : null
        if (directUrl) {
          const info = { url: directUrl }
          thumbCacheRef.current.set(cacheKey, info)
          return info
        }

        const file = await resolveFile(item)
        if (!file) return null

        const generated = await generateThumb(file, item.kind)
        if (!generated) return null

        await putThumb({
          id: cacheKey,
          blob: generated.blob,
          durationSec: generated.durationSec,
        })
        const info: ThumbInfo = {
          url: URL.createObjectURL(generated.blob),
          durationSec: generated.durationSec,
        }
        thumbCacheRef.current.set(cacheKey, info)
        return info
      })()

      thumbPendingRef.current.set(cacheKey, task)
      try {
        return await task
      } finally {
        thumbPendingRef.current.delete(cacheKey)
      }
    },
    [resolveFile, resolveUrl],
  )

  const ingest = useCallback(
    async (files: FileList | File[] | null, sourceId: string, persist: boolean) => {
      const list = files ? (Array.isArray(files) ? files : Array.from(files)) : []
      if (list.length === 0) return
      const scanKinds = new Set(enabledKindsRef.current)

      // Aynı kaynak yeniden taranıyorsa eskisini durdur; farklı kaynaklar
      // birbirinden bağımsız, eşzamanlı taranır.
      scanControllersRef.current.get(sourceId)?.abort()
      const controller = new AbortController()
      scanControllersRef.current.set(sourceId, controller)
      // Bu tarama, yerine yenisi başlamadığı sürece kendi ilerlemesini yönetir.
      const isCurrent = () =>
        scanControllersRef.current.get(sourceId) === controller

      setError(null)
      setScans((prev) =>
        new Map(prev).set(sourceId, { done: 0, total: list.length }),
      )
      try {
        const {
          items: next,
          files: freshFiles,
          skipped: miss,
          skippedNames: missNames,
          mediaCount,
          ignoredCount,
          cachedCount: cached,
        } = await scanFiles(
          list,
          sourceId,
          (done, total) => {
            if (isCurrent()) {
              setScans((prev) => new Map(prev).set(sourceId, { done, total }))
            }
          },
          controller.signal,
          true,
          scanKinds,
        )

        for (const [id, file] of freshFiles) fileMapRef.current.set(id, file)

        if (persist) {
          // Tam taramada kaynağı yenile; tür filtresi açıksa diğer türlerin
          // daha önceki kütüphane kayıtlarını koru.
          if (scanKinds.size === ALL_KINDS.length) {
            await deleteLibraryItemsBySource(sourceId)
          } else {
            const oldSelectedIds = itemsRef.current
              .filter((i) => i.sourceId === sourceId && scanKinds.has(i.kind))
              .map((i) => i.id)
            await deleteLibraryItems(oldSelectedIds)
          }
          await putLibraryItems(next.map(toLibraryItem))
        }

        // Aynı kaynağın eski URL'lerini serbest bırak, öğeleri değiştir
        for (const [id, url] of urlCacheRef.current) {
          if (id.startsWith(`${sourceId}|`)) {
            URL.revokeObjectURL(url)
            urlCacheRef.current.delete(id)
          }
        }

        const nextIds = new Set(next.map((i) => i.id))
        setItems((prev) => [
          ...prev.filter(
            (i) =>
              !nextIds.has(i.id) &&
              (i.sourceId !== sourceId || !scanKinds.has(i.kind)),
          ),
          ...next,
        ])
        setGrantedIds((prev) => new Set(prev).add(sourceId))
        setSkipped(miss)
        setSkippedNames(missNames)
        setCachedCount(cached)
        setViewer(null)

        if (next.length === 0) {
          if (mediaCount === 0) {
            setError(
              ignoredCount > 0
                ? `${ignoredCount} dosya bulundu ama hiç foto/video/GoPro yok.`
                : 'Seçilen klasörde medya dosyası yok.',
            )
          }
        }
      } catch (e) {
        if (e instanceof ScanAbortedError) {
          // Aynı kaynak için yeni tarama başladıysa sessiz kal; sadece
          // kullanıcı İptal'e bastıysa bildir.
          if (isCurrent()) setError('Okuma iptal edildi.')
        } else if (isCurrent()) {
          setError(friendlyError(e, 'Dosyalar okunamadı.'))
        }
      } finally {
        if (isCurrent()) {
          scanControllersRef.current.delete(sourceId)
          setScans((prev) => {
            const next = new Map(prev)
            next.delete(sourceId)
            return next
          })
        }
      }
    },
    [],
  )

  const addFolder = useCallback(async () => {
    if (!canPickFolder()) {
      folderInputRef.current?.click()
      return
    }
    try {
      const handle = await pickFolderHandle()
      if (handle === null) {
        folderInputRef.current?.click()
        return
      }
      if (handle === 'cancelled') return
      // Başlangıçta kapalı kalsın; yeni kaynak eklenirken tarama ilerlemesi
      // görünür olmalı.
      setSourcesOpen(true)

      // 1) Birebir aynı klasör zaten ekliyse kopya oluşturma: yeniden tara
      for (const [id, h] of handlesRef.current) {
        if (await isSameFolder(h, handle)) {
          setError('Bu klasör zaten ekli; yeniden taranıyor.')
          const files = await readFilesFromHandle(handle, (name) =>
            acceptsFileName(name, enabledKindsRef.current),
          )
          await ingest(files, id, true)
          return
        }
      }

      // 1b) Yerel sürücü / alt klasörlerle çakışma (yol + medya yolu)
      const nameLower = handle.name.toLowerCase()
      for (const source of sourcesRef.current) {
        const existing =
          localPathForSource(source, sourcesRef.current) ?? source.localPath
        if (existing) {
          const leaf = existing
            .replace(/[\\/]+$/, '')
            .split(/[\\/]/)
            .pop()
            ?.toLowerCase()
          if (leaf === nameLower) {
            setError(
              `“${handle.name}” zaten “${source.label}” olarak yüklü` +
                (source.parentId || source.isAnchor
                  ? ' (sürücü taramasında). Ayrı ekleme.'
                  : '.'),
            )
            return
          }
        }
        if (source.subPath) {
          const parts = source.subPath.split('/').map((p) => p.toLowerCase())
          if (parts.includes(nameLower)) {
            const parent = sourcesRef.current.find((s) => s.id === source.parentId)
            setError(
              `“${handle.name}” zaten “${parent?.label ?? 'sürücü'}” altında yüklü` +
                ` (${source.subPath.replaceAll('/', '\\')}).`,
            )
            return
          }
        }
      }
      for (const anchor of sourcesRef.current.filter((s) => s.isAnchor)) {
        const related = new Set(
          sourcesRef.current
            .filter((s) => s.id === anchor.id || s.parentId === anchor.id)
            .map((s) => s.id),
        )
        for (const item of itemsRef.current) {
          if (!related.has(item.sourceId)) continue
          const rel = (item.relativePath || item.name)
            .replaceAll('\\', '/')
            .toLowerCase()
          if (rel.split('/').includes(nameLower)) {
            setError(
              `“${handle.name}” zaten “${anchor.label}” sürücü taramasında var. ` +
                'Kaynaklar listesinde sürücünün alt klasörlerine bak.',
            )
            return
          }
        }
      }

      // 2) Mevcut kaynaklarla ilişki: çapa altına yerleşir,
      //    taranmış kaynak kapsamındaysa mükerrer veri olmasın diye eklenmez
      let parentId: string | undefined
      let subPath: string | undefined
      for (const source of sourcesRef.current) {
        const h = handlesRef.current.get(source.id)
        if (!h) continue
        const rel = await relativePathIfDescendant(h, handle)
        if (!rel) continue
        if (source.isAnchor) {
          // En derin (en yakın) çapayı seç
          if (!subPath || rel.length < subPath.split('/').length) {
            parentId = source.id
            subPath = rel.join('/')
          }
        } else {
          setError(
            `Bu klasör zaten "${source.label}" kaynağının içinde; ` +
              'ayrıca eklemek haritada mükerrer kayıt oluşturur.',
          )
          return
        }
      }

      // 3) Yeni klasör, taranmış bir kaynağı kapsıyorsa da engelle
      for (const source of sourcesRef.current) {
        if (source.isAnchor) continue
        const h = handlesRef.current.get(source.id)
        if (!h) continue
        const rel = await relativePathIfDescendant(handle, h)
        if (rel) {
          setError(
            `Bu klasör, ekli "${source.label}" kaynağını kapsıyor. ` +
              'Mükerrer kayıt olmaması için önce onu × ile kaldır.',
          )
          return
        }
      }

      const sourceId = `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      handlesRef.current.set(sourceId, handle)
      const addedAt = Date.now()
      await putSource({
        id: sourceId,
        label: handle.name,
        addedAt,
        handle,
        parentId,
        subPath,
      })
      setSources((prev) => [
        ...prev,
        { id: sourceId, label: handle.name, addedAt, parentId, subPath },
      ])
      if (parentId) {
        setExpandedTree((prev) => {
          const next = new Set(prev)
          for (const key of expandKeysForDriveChildren(parentId, [
            {
              id: sourceId,
              label: handle.name,
              addedAt,
              parentId,
              subPath,
            },
          ])) {
            next.add(key)
          }
          return next
        })
      }

      setGrantedIds((prev) => new Set(prev).add(sourceId))
      const files = await readFilesFromHandle(handle, (name) =>
        acceptsFileName(name, enabledKindsRef.current),
      )
      await ingest(files, sourceId, true)
    } catch (e) {
      setError(friendlyError(e, 'Klasör eklenemedi.'))
    }
  }, [ingest])

  const scanLocalPath = useCallback(async (
    existingPath?: string,
    existingId?: string,
    preferredLabel?: string,
  ) => {
    if (!existingPath?.trim()) {
      setError('Sürücü yolu kayıtlı değil. Kaynağı kaldırıp “+ Sürücü ekle” ile yeniden ekle.')
      return
    }
    const path = existingPath.trim()
    const sourceId = existingId ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const label =
      preferredLabel?.trim()
      || path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop()
      || path

    // Yol çakışması: aynı / kapsayan / kapsanan kaynak
    if (!existingId) {
      for (const source of sourcesRef.current) {
        const existing =
          localPathForSource(source, sourcesRef.current) ?? source.localPath
        if (!existing) continue
        if (pathEqualsOrInside(path, existing)) {
          if (normalizeWinPath(path) === normalizeWinPath(existing)) {
            setError(
              `“${source.label}” zaten ekli. Yeniden taramak için listedeki ↻ düğmesini kullan.`,
            )
            return
          }
          setError(
            `Bu klasör zaten “${source.label}” içinde yüklü` +
              (source.isAnchor || isDriveRootPath(existing)
                ? ' (sürücü taraması onu kapsıyor).'
                : '. Ayrı eklemek mükerrer kayıt oluşturur.'),
          )
          return
        }
        if (
          !source.isAnchor &&
          pathEqualsOrInside(existing, path) &&
          !isDriveRootPath(path)
        ) {
          setError(
            `Bu yol, ekli “${source.label}” kaynağını kapsıyor. ` +
              'Önce onu × ile kaldır veya sürücü olarak ekle.',
          )
          return
        }
      }
    }

    // Sürücü eklenirken altındaki elle eklenmiş klasörleri temizle (yeniden çocuk olacak)
    let absorbedCount = 0
    if (isDriveRootPath(path) && !existingId) {
      const absorb = sourcesRef.current.filter((source) => {
        if (source.isAnchor || source.id === sourceId) return false
        const existing =
          localPathForSource(source, sourcesRef.current) ?? source.localPath
        return Boolean(existing && pathEqualsOrInside(existing, path))
      })
      if (absorb.length > 0) {
        absorbedCount = absorb.length
        const removeIds = new Set(absorb.map((s) => s.id))
        for (const rid of removeIds) {
          void deleteSource(rid)
          void deleteLibraryItemsBySource(rid)
          handlesRef.current.delete(rid)
        }
        setSources((prev) => prev.filter((s) => !removeIds.has(s.id)))
        setItems((prev) => prev.filter((i) => !removeIds.has(i.sourceId)))
        setGrantedIds((prev) => {
          const next = new Set(prev)
          for (const rid of removeIds) next.delete(rid)
          return next
        })
      }
    }

    setError(null)
    setSourcesOpen(false)
    setDriveDialogOpen(false)
    // Tarama başlarken kaynağı bağlı say — kırmızı “Disk bağlı değil” olmasın
    setGrantedIds((prev) => new Set(prev).add(sourceId))
    setLocalOnlineIds((prev) => new Set(prev).add(sourceId))
    setLocalAvailabilityReady(true)
    setScans((prev) => new Map(prev).set(sourceId, { done: 0, total: 0 }))
    scanControllersRef.current.get(sourceId)?.abort()
    const controller = new AbortController()
    scanControllersRef.current.set(sourceId, controller)
    const signal = controller.signal
    // Kaynak hemen listede görünsün
    const startedAt = Date.now()
    setSources((prev) => {
      if (existingId || prev.some((s) => s.id === sourceId)) {
        return prev.map((s) =>
          s.id === sourceId ? { ...s, label, localPath: path } : s,
        )
      }
      return [
        ...prev,
        {
          id: sourceId,
          label,
          localPath: path,
          addedAt: startedAt,
          isAnchor: isDriveRootPath(path),
        },
      ]
    })
    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, sourceId }),
        signal,
      })
      const data = await response.json() as {
        error?: string; jobId?: string
        items?: Array<Omit<MediaItem, 'takenAt'> & { takenAt?: string }>
      }
      if (!response.ok) throw new Error(data.error || 'Yerel tarama başlatılamadı.')
      if (data.jobId) scanJobIdsRef.current.set(sourceId, data.jobId)
      const received: Array<Omit<MediaItem, 'takenAt'> & { takenAt?: string }> = []
      const seenIds = new Set<string>()

      const publishLive = (
        batch: Array<Omit<MediaItem, 'takenAt'> & { takenAt?: string }>,
      ) => {
        if (batch.length === 0) return
        const fresh = batch
          .filter((item) => !/\.lrv$/i.test(item.name) && !seenIds.has(item.id))
          .map((item) => {
            seenIds.add(item.id)
            return {
              ...item,
              takenAt: item.takenAt ? new Date(item.takenAt) : undefined,
              url: undefined,
              available: true,
            } as MediaItem
          })
        if (fresh.length === 0) return

        // Önceki GPS'i koru (aynı id yeniden gelirse)
        const withPreserved = fresh.map((item) => {
          const prev = itemsRef.current.find((p) => p.id === item.id)
          if (
            item.locationMissing &&
            prev &&
            !prev.locationMissing &&
            !isNullIslandCoordinate(prev.latitude, prev.longitude)
          ) {
            return {
              ...item,
              latitude: prev.latitude,
              longitude: prev.longitude,
              locationMissing: false,
              takenAt: item.takenAt ?? prev.takenAt,
            }
          }
          return item
        })

        setItems((prev) => {
          const byId = new Map(prev.map((item) => [item.id, item]))
          for (const item of withPreserved) byId.set(item.id, item)
          return [...byId.values()]
        })
        void putLibraryItems(withPreserved.map(toLibraryItem))
      }

      if (data.jobId) {
        let after = 0
        for (;;) {
          if (signal.aborted) break
          await new Promise<void>((resolve) => window.setTimeout(resolve, 350))
          if (signal.aborted) break
          const statusResponse = await fetch(
            `/api/scan/${encodeURIComponent(data.jobId)}?after=${after}`,
            { signal },
          )
          const status = await statusResponse.json() as {
          error?: string; total?: number; processed?: number; itemCount?: number; done?: boolean; located?: number; missing?: number; cancelled?: boolean
            items?: Array<Omit<MediaItem, 'takenAt'> & { takenAt?: string }>
          }
          if (!statusResponse.ok) throw new Error(status.error || 'Tarama durumu okunamadı.')
          if (status.items?.length) {
            received.push(...status.items)
            publishLive(status.items)
          }
          after = status.itemCount ?? after
          setScans((prev) => new Map(prev).set(sourceId, {
          done: status.processed ?? 0,
          total: status.total ?? 0,
          located: status.located ?? 0,
          missing: status.missing ?? 0,
          }))
          if (status.done || status.cancelled) {
            if (status.error && !status.cancelled) throw new Error(status.error)
            break
          }
        }
      } else if (data.items) {
        // Eski hizmet açıksa yine de taramayı tamamla; yalnızca canlı sayaç yoktur.
        received.push(...data.items)
        publishLive(data.items)
      } else {
        throw new Error(data.error || 'Yerel tarama başlatılamadı.')
      }
      if (signal.aborted) {
        setError('Tarama iptal edildi. Bulunanlar haritada kaldı.', 'info')
        return
      }
      const next = received
        .filter((item) => !/\.lrv$/i.test(item.name))
        .map((item) => ({
          ...item,
          takenAt: item.takenAt ? new Date(item.takenAt) : undefined,
          url: undefined,
        }))
      const previousSnapshot = new Map(
        itemsRef.current
          .filter((item) => item.sourceId === sourceId)
          .map((item) => [item.id, item]),
      )
      const mergedNext = next.map((item) => {
        const prev = previousSnapshot.get(item.id)
        if (
          item.locationMissing &&
          prev &&
          !prev.locationMissing &&
          !isNullIslandCoordinate(prev.latitude, prev.longitude)
        ) {
          return {
            ...item,
            latitude: prev.latitude,
            longitude: prev.longitude,
            locationMissing: false,
            takenAt: item.takenAt ?? prev.takenAt,
          }
        }
        return item
      })
      // Canlı yayında zaten eklendi; finalde bu taranın sonuçlarını netleştir
      let finalItems: MediaItem[] = mergedNext as MediaItem[]
      let childSources: SourceUi[] = []
      const absorbedOrphanIds = new Set<string>()

      if (isDriveRootPath(path)) {
        const folderPaths = mediaFolderSubPaths(mergedNext as MediaItem[])
        const existingChildren = sourcesRef.current.filter(
          (s) => s.parentId === sourceId && s.subPath != null,
        )
        const bySub = new Map(
          existingChildren.map((s) => [s.subPath as string, s]),
        )
        childSources = []
        for (const subPath of folderPaths) {
          const childPath =
            subPath === ''
              ? `${path.replace(/[\\/]+$/, '')}\\`
              : `${path.replace(/[\\/]+$/, '')}\\${subPath.replaceAll('/', '\\')}`
          const prev = bySub.get(subPath)
          if (prev) {
            childSources.push({ ...prev, localPath: childPath })
            continue
          }
          const childId = `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${childSources.length}`
          const childLabel =
            subPath === ''
              ? '(kök)'
              : subPath.split('/').filter(Boolean).pop() || subPath
          childSources.push({
            id: childId,
            label: childLabel,
            addedAt: Date.now(),
            localPath: childPath,
            parentId: sourceId,
            subPath,
            directOnly: true,
          })
        }

        finalItems = remapItemsToDriveChildren(
          mergedNext,
          sourceId,
          childSources.map((c) => ({ id: c.id, subPath: c.subPath ?? '' })),
        )

        // Eski çapa-id'li kütüphane kayıtlarını temizle
        await deleteLibraryItemsBySource(sourceId)
        for (const child of existingChildren) {
          if (!folderPaths.includes(child.subPath ?? '')) {
            await deleteSource(child.id)
            await deleteLibraryItemsBySource(child.id)
          }
        }

        for (const child of childSources) {
          await putSource({
            id: child.id,
            label: child.label,
            addedAt: child.addedAt,
            localPath: child.localPath,
            parentId: sourceId,
            subPath: child.subPath,
            directOnly: true,
          })
        }

        setExpandedTree((prev) => {
          const next = new Set(prev)
          for (const key of expandKeysForDriveChildren(sourceId, childSources)) {
            next.add(key)
          }
          return next
        })
        setGrantedIds((prev) => {
          const next = new Set(prev)
          next.add(sourceId)
          for (const child of childSources) next.add(child.id)
          return next
        })
        setLocalOnlineIds((prev) => {
          const next = new Set(prev)
          next.add(sourceId)
          for (const child of childSources) next.add(child.id)
          return next
        })

        // Aynı isimli üst seviye “Klasör ekle” kaynaklarını birleştir
        const childLabels = new Set(
          childSources.map((c) => c.label.toLowerCase()),
        )
        for (const s of sourcesRef.current) {
          if (s.isAnchor || s.parentId || s.id === sourceId) continue
          if (childSources.some((c) => c.id === s.id)) continue
          if (!childLabels.has(s.label.toLowerCase())) continue
          absorbedOrphanIds.add(s.id)
        }
        if (absorbedOrphanIds.size > 0) {
          absorbedCount += absorbedOrphanIds.size
          for (const rid of absorbedOrphanIds) {
            void deleteSource(rid)
            void deleteLibraryItemsBySource(rid)
            handlesRef.current.delete(rid)
          }
        }
      }

      setItems((prev) => {
        const childIdSet = new Set(childSources.map((c) => c.id))
        const keptOther = prev.filter((item) => {
          if (absorbedOrphanIds.has(item.sourceId)) return false
          if (item.sourceId === sourceId) return false
          if (childIdSet.has(item.sourceId)) return false
          const parent = sourcesRef.current.find((s) => s.id === item.sourceId)
          if (parent?.parentId === sourceId) return false
          return true
        })
        const byId = new Map(keptOther.map((item) => [item.id, item]))
        for (const item of finalItems) byId.set(item.id, item)
        return [...byId.values()]
      })
      setSources((prev) => {
        const withoutStaleChildren = prev.filter(
          (source) =>
            !absorbedOrphanIds.has(source.id) &&
            source.id !== sourceId &&
            !(source.parentId === sourceId && !childSources.some((c) => c.id === source.id)),
        )
        const anchor: SourceUi = {
          ...(sourcesRef.current.find((source) => source.id === sourceId) ?? {
            id: sourceId,
            label,
            addedAt: startedAt,
          }),
          id: sourceId,
          label,
          localPath: path,
          addedAt:
            sourcesRef.current.find((source) => source.id === sourceId)?.addedAt ??
            startedAt,
          isAnchor: isDriveRootPath(path),
          parentId: undefined,
          subPath: undefined,
        }
        if (!isDriveRootPath(path)) {
          const existingSource = sourcesRef.current.find((source) => source.id === sourceId)
          return [
            ...withoutStaleChildren.filter((s) => s.id !== sourceId),
            {
              ...anchor,
              isAnchor: existingSource?.isAnchor ?? false,
              parentId: existingSource?.parentId,
              subPath: existingSource?.subPath,
              directOnly: existingSource?.directOnly,
            },
          ]
        }
        return [...withoutStaleChildren, anchor, ...childSources]
      })
      const existingSource = sourcesRef.current.find((source) => source.id === sourceId)
      const existingHandle = handlesRef.current.get(sourceId)
      await putSource({
        id: sourceId,
        label,
        addedAt: existingSource?.addedAt ?? startedAt,
        handle: existingHandle,
        localPath: path,
        parentId: isDriveRootPath(path) ? undefined : existingSource?.parentId,
        subPath: isDriveRootPath(path) ? undefined : existingSource?.subPath,
        isAnchor: isDriveRootPath(path) || (existingSource?.isAnchor ?? false),
        directOnly: isDriveRootPath(path) ? undefined : existingSource?.directOnly,
      })
      await putLibraryItems(finalItems.map(toLibraryItem))
      setGrantedIds((prev) => new Set(prev).add(sourceId))
      const missingGps = finalItems.filter((item) => item.locationMissing).length
      setSkipped(missingGps)
      setViewer(null)
      const locatedCount = finalItems.length - missingGps
      const sourceName = label || path
      const branchNote =
        isDriveRootPath(path) && childSources.length > 0
          ? ` · ${childSources.length} klasör`
          : ''
      const absorbNote =
        absorbedCount > 0 ? ` · ${absorbedCount} alt kaynak birleştirildi` : ''
      setError(
        existingId
          ? `“${sourceName}” güncellendi · ${finalItems.length} medya (${locatedCount} GPS)${branchNote}`
          : `“${sourceName}” eklendi · ${finalItems.length} medya (${locatedCount} GPS)${branchNote}${absorbNote}`,
        'info',
      )
    } catch (e) {
      if (signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
        setError('Tarama iptal edildi. Bulunanlar haritada kaldı.', 'info')
        return
      }
      setError(friendlyError(e, 'Yerel klasör taranamadı.'))
    } finally {
      scanControllersRef.current.delete(sourceId)
      scanJobIdsRef.current.delete(sourceId)
      setScans((prev) => {
        const nextMap = new Map(prev)
        nextMap.delete(sourceId)
        return nextMap
      })
    }
  }, [])

  /** Önce masaüstü yol seçici (çakışma net); olmazsa tarayıcı klasör seçici. */
  const addFolderSmart = useCallback(async () => {
    try {
      const pick = await fetch('/api/pick-folder', { method: 'POST' })
      if (pick.ok) {
        const data = (await pick.json()) as {
          path?: string
          cancelled?: boolean
        }
        if (data.cancelled) return
        if (data.path) {
          setSourcesOpen(true)
          await scanLocalPath(data.path)
          return
        }
      }
    } catch { /* FSA */ }
    await addFolder()
  }, [addFolder, scanLocalPath])

  const loadSourceFiles = useCallback(
    async (id: string) => {
      const handle = handlesRef.current.get(id)
      if (!handle) return []
      const source = sourcesRef.current.find((s) => s.id === id)
      const accept = (name: string) =>
        acceptsFileName(name, enabledKindsRef.current)
      if (source?.directOnly) {
        return readDirectFilesFromHandle(handle, accept)
      }
      return readFilesFromHandle(handle, accept)
    },
    [],
  )

  /**
   * Tek parça eklenmiş klasörü (ör. 2.7GB) medyalı alt klasör dallarına böler.
   * Ağaçta alt klasörler görünür; her dal kendi dosyalarını tarar.
   */
  const expandSourceBranches = useCallback(
    async (id: string) => {
      const source = sourcesRef.current.find((s) => s.id === id)
      const handle = handlesRef.current.get(id)
      if (!source || !handle) return
      if (source.isAnchor) {
        setError('Bu zaten bir sürücü kökü; alt dallar ▸ ile açılır.')
        return
      }

      try {
        const ok = await ensureReadPermission(handle, true)
        if (!ok) {
          setError('Klasör izni verilmedi.')
          return
        }

        setError(`"${source.label}" altında medyalı klasörler aranıyor…`, 'info')
        const discovered = await discoverMediaFolders(handle, isSupportedMediaFileName)
        const nested = discovered.filter((d) => d.subPath !== '')
        if (nested.length === 0) {
          setError(
            `"${source.label}" altında ayrı medya klasörü yok. ` +
              'Dosyalar doğrudan bu klasörde veya alt klasörlerde medya bulunamadı.',
          )
          return
        }

        const driveParentId = source.parentId
        const baseSubPath = source.subPath?.replace(/\/$/, '') ?? ''
        const anchorId = driveParentId ?? id

        // Eski tek parça kütüphaneyi temizle (dallar yeniden tarayacak)
        await deleteLibraryItemsBySource(id)
        for (const [key, url] of urlCacheRef.current) {
          if (key.startsWith(`${id}|`)) {
            URL.revokeObjectURL(url)
            urlCacheRef.current.delete(key)
          }
        }
        for (const key of [...fileMapRef.current.keys()]) {
          if (key.startsWith(`${id}|`)) fileMapRef.current.delete(key)
        }
        setItems((prev) => prev.filter((i) => i.sourceId !== id))

        if (!driveParentId) {
          // Tepe klasör → çapa (ağaç kökü)
          await putSource({
            id,
            label: source.label,
            addedAt: source.addedAt,
            handle,
            isAnchor: true,
          })
          setSources((prev) =>
            prev.map((s) =>
              s.id === id
                ? {
                    ...s,
                    isAnchor: true,
                    directOnly: undefined,
                    parentId: undefined,
                    subPath: undefined,
                  }
                : s,
            ),
          )
        } else {
          // Sürücü altındaki şişkin klasörü kaldır; dallar sürücüye bağlanır
          await deleteSource(id)
          handlesRef.current.delete(id)
          setSources((prev) => prev.filter((s) => s.id !== id))
          setGrantedIds((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        }

        const existingPaths = new Set(
          sourcesRef.current
            .filter((s) => s.parentId === anchorId && s.subPath != null)
            .map((s) => s.subPath as string),
        )

        const newChildren: SourceUi[] = []
        for (const folder of discovered) {
          const fullSub = driveParentId
            ? folder.subPath
              ? `${baseSubPath}/${folder.subPath}`
              : baseSubPath
            : folder.subPath
          if (existingPaths.has(fullSub)) continue

          const childId = `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const label =
            fullSub.split('/').filter(Boolean).pop() || source.label
          handlesRef.current.set(childId, folder.handle)
          const record = {
            id: childId,
            label,
            addedAt: Date.now(),
            handle: folder.handle,
            parentId: anchorId,
            subPath: fullSub,
            directOnly: true as const,
          }
          await putSource(record)
          newChildren.push({
            id: childId,
            label,
            addedAt: record.addedAt,
            parentId: anchorId,
            subPath: fullSub,
            directOnly: true,
          })
          existingPaths.add(fullSub)
        }

        setGrantedIds((prev) => {
          const next = new Set(prev).add(anchorId)
          for (const c of newChildren) next.add(c.id)
          return next
        })
        setSources((prev) => [...prev, ...newChildren])
        setExpandedTree((prev) => {
          const next = new Set(prev)
          // Kullanıcının tıkladığı kaynak yolunu açık bırak; onun altını
          // otomatik açma.
          if (baseSubPath) next.add(`${anchorId}::${baseSubPath}`)
          return next
        })

        setError(
          `"${source.label}": ${newChildren.length} alt dal eklendi. GPS okunuyor…`,
        )
        await forEachWithConcurrency(newChildren, 2, async (child) => {
          const h = handlesRef.current.get(child.id)
          if (!h) return
          const files = await readDirectFilesFromHandle(h, (name) =>
            acceptsFileName(name, enabledKindsRef.current),
          )
          if (files.length > 0) await ingest(files, child.id, true)
        })
      } catch (e) {
        setError(friendlyError(e, 'Alt klasörler keşfedilemedi.'))
      }
    },
    [ingest],
  )

  /** Sürücü kökünü ekler, medyalı klasörleri alt dal olarak keşfeder ve tarar. */
  const registerDrive = useCallback(async () => {
    if (!canPickFolder()) return
    try {
      const handle = await pickFolderHandle()
      if (handle === null || handle === 'cancelled') return
      // Sürücü yeniden eklendiğinde otomatik keşif/tarama ilerlemesini göster.
      setSourcesOpen(true)

      for (const [, h] of handlesRef.current) {
        if (await isSameFolder(h, handle)) {
          setError('Bu sürücü/klasör zaten kayıtlı.')
          return
        }
      }

      const typed = window.prompt(
        'Sürücü/disk adı (ör. "4TB Seyahat", "1TB Yedek"):',
        handle.name,
      )
      if (typed === null) return
      const driveLabel = typed.trim() || handle.name

      const anchorId = `src-anchor-${Date.now()}`
      const addedAt = Date.now()
      handlesRef.current.set(anchorId, handle)
      await putSource({
        id: anchorId,
        label: driveLabel,
        addedAt,
        handle,
        isAnchor: true,
      })

      setError(`"${driveLabel}" taranıyor: medyalı klasörler aranıyor…`, 'info')
      const discovered = await discoverMediaFolders(handle, isSupportedMediaFileName)

      // Mevcut kaynakları bu kökün altına bağla
      const relinked = new Map<string, { parentId: string; subPath: string }>()
      for (const source of sourcesRef.current) {
        if (source.isAnchor || source.parentId) continue
        const h = handlesRef.current.get(source.id)
        if (!h) continue
        const rel = await relativePathIfDescendant(handle, h)
        if (rel) {
          const link = { parentId: anchorId, subPath: rel.join('/') }
          relinked.set(source.id, link)
          await putSource({
            id: source.id,
            label: source.label,
            addedAt: source.addedAt,
            handle: h,
            directOnly: source.directOnly,
            ...link,
          })
        }
      }

      const existingPaths = new Set(
        [...relinked.values()].map((l) => l.subPath),
      )
      for (const source of sourcesRef.current) {
        if (source.parentId === anchorId && source.subPath != null) {
          existingPaths.add(source.subPath)
        }
      }

      const newChildren: SourceUi[] = []
      for (const folder of discovered) {
        if (existingPaths.has(folder.subPath)) continue
        const childId = `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const label =
          folder.subPath.split('/').filter(Boolean).pop() || driveLabel
        handlesRef.current.set(childId, folder.handle)
        const record = {
          id: childId,
          label,
          addedAt: Date.now(),
          handle: folder.handle,
          parentId: anchorId,
          subPath: folder.subPath,
          directOnly: true,
        }
        await putSource(record)
        newChildren.push({
          id: childId,
          label,
          addedAt: record.addedAt,
          parentId: anchorId,
          subPath: folder.subPath,
          directOnly: true,
        })
        existingPaths.add(folder.subPath)
      }

      setGrantedIds((prev) => {
        const next = new Set(prev).add(anchorId)
        for (const c of newChildren) next.add(c.id)
        return next
      })
      setSources((prev) => [
        ...prev.map((s) => {
          const link = relinked.get(s.id)
          return link ? { ...s, ...link } : s
        }),
        { id: anchorId, label: driveLabel, addedAt, isAnchor: true },
        ...newChildren,
      ])

      const totalDirect = discovered.reduce((sum, f) => sum + f.directCount, 0)
      setError(
        `"${driveLabel}": ${newChildren.length} medyalı klasör bulundu` +
          (totalDirect ? ` (~${totalDirect} dosya). GPS okunuyor…` : '.'),
      )

      // Her dalı kendi klasöründe tara (yalnızca doğrudan dosyalar)
      await forEachWithConcurrency(newChildren, 2, async (child) => {
        const childHandle = handlesRef.current.get(child.id)
        if (!childHandle) return
        const files = await readDirectFilesFromHandle(childHandle, (name) =>
          acceptsFileName(name, enabledKindsRef.current),
        )
        if (files.length > 0) await ingest(files, child.id, true)
      })
    } catch (e) {
      setError(friendlyError(e, 'Sürücü eklenemedi.'))
    }
  }, [ingest])

  const reconnectSource = useCallback(
    async (id: string) => {
      const source = sourcesRef.current.find((item) => item.id === id)
      if (source) {
        let path = localPathForSource(source, sourcesRef.current)
        if (!path) {
          const handle = handlesRef.current.get(id)
          if (handle) {
            try {
              const ok = await ensureReadPermission(handle, true)
              if (ok && (await isSourceAvailable(handle))) {
                setGrantedIds((prev) => new Set(prev).add(id))
                setError(null)
                return
              }
            } catch { /* alttaki yol isteği */ }
          }
          const typed = window.prompt(
            `"${source.label}" klasörünün tam yolunu yaz (ör. E:\\DCIM\\100GOPRO):`,
            '',
          )
          path = typed?.trim() || undefined
          if (!path) {
            setError(
              'Bu kaynak için klasör yolu yok. Yolu yaz veya kaynağı kaldırıp “+ Sürücü ekle” ile yeniden ekle.',
            )
            return
          }
        }
        await scanLocalPath(path, id, source.label)
        return
      }
      const handle = handlesRef.current.get(id)
      if (!handle) return
      try {
        const ok = await ensureReadPermission(handle, true)
        if (ok && (await isSourceAvailable(handle))) {
          setGrantedIds((prev) => new Set(prev).add(id))
          setError(null)
          // Kütüphanede bu kaynağa ait kayıt yoksa (ör. eski sürümden
          // aktarılan klasör) otomatik tara; önbellek sayesinde hızlıdır.
          // Taramalar eşzamanlı çalışır, diğerlerini etkilemez.
          const hasItems = itemsRef.current.some((i) => i.sourceId === id)
          if (!hasItems && !scanControllersRef.current.has(id)) {
            const files = await loadSourceFiles(id)
            if (files.length > 0) await ingest(files, id, true)
          }
        } else {
          setError('Disk bağlı değil ya da izin verilmedi.')
        }
      } catch (e) {
        setError(friendlyError(e, 'Kaynağa bağlanılamadı.'))
      }
    },
    [ingest, loadSourceFiles, scanLocalPath],
  )

  const rescanSource = useCallback(
    async (id: string) => {
      const source = sourcesRef.current.find((item) => item.id === id)
      if (source) {
        let path = localPathForSource(source, sourcesRef.current)
        if (!path?.trim()) {
          const typed = window.prompt(
            `"${source.label}" için klasör/sürücü yolu:`,
            source.isAnchor ? '' : '',
          )
          path = typed?.trim() || undefined
        }
        if (!path?.trim()) {
          setError(
            'Bu kaynak için yol bulunamadı. Sürücüyse “+ Sürücü ekle” ile ekle; klasörse yolu yaz.',
          )
          return
        }
        await scanLocalPath(path, id, source.label)
        return
      }
      const handle = handlesRef.current.get(id)
      if (!handle) return
      try {
        const ok = await ensureReadPermission(handle, true)
        if (!ok) {
          setError('Klasör izni verilmedi.')
          return
        }
        const files = await loadSourceFiles(id)
        await ingest(files, id, true)
      } catch (e) {
        setError(friendlyError(e, 'Klasör taranamadı.'))
      }
    },
    [ingest, loadSourceFiles, scanLocalPath],
  )

  const rescanAll = useCallback(async () => {
    const targets = sourcesRef.current.filter(
      (s) => !s.isAnchor && grantedIds.has(s.id),
    )
    if (targets.length === 0) {
      setError(
        'Taranacak bağlı kaynak yok. Önce Kaynaklar’dan “Bağlan” ile diskleri aç.',
      )
      return
    }
    setError(null)
    // Bağlı kaynakları paralel tara; her biri kendi ilerlemesini gösterir.
    await Promise.all(targets.map((s) => rescanSource(s.id)))
  }, [grantedIds, rescanSource])

  // Eski tarayıcı-tabanlı sürücü ekleme/yığın tarama yolu artık arayüzde
  // gösterilmez; yerel sürücü akışına geçiş tamamlanana kadar saklı tutulur.
  void registerDrive
  void rescanAll

  // Surucu satiri bir grup basligidir. Buna da bagla/tara eylemi veriyoruz;
  // tarama sonucu basligin altindaki "(kok)" dali olarak gorunur.
  const scanAnchorSource = useCallback(async (anchorId: string) => {
    const anchor = sourcesRef.current.find((source) => source.id === anchorId)
    if (!anchor) return
    const existingRoot = sourcesRef.current.find(
      (source) => source.parentId === anchorId && source.subPath === '',
    )
    const path =
      existingRoot?.localPath ??
      anchor.localPath ??
      localPathForSource(anchor, sourcesRef.current) ??
      window.prompt(`"${anchor.label}" sürücü yolu (ör. E:\\):`, '') ??
      undefined
    if (!path?.trim()) {
      setError(
        'Sürücü yolu bulunamadı. Kaynağı kaldırıp “+ Sürücü ekle” ile yeniden ekle veya yolu yaz.',
      )
      return
    }

    if (existingRoot) {
      await scanLocalPath(path, existingRoot.id, anchor.label)
      return
    }

    // Çapayı doğrudan tara (kök çocuğu yoksa) — localPath kaydı güncellenir
    await putSource({
      id: anchor.id,
      label: anchor.label,
      addedAt: anchor.addedAt,
      localPath: path.trim(),
      isAnchor: true,
    })
    setSources((prev) =>
      prev.map((s) =>
        s.id === anchorId ? { ...s, localPath: path.trim(), isAnchor: true } : s,
      ),
    )
    await scanLocalPath(path.trim(), anchorId, anchor.label)
  }, [scanLocalPath])

  const removeSource = useCallback(async (id: string) => {
    const target = sourcesRef.current.find((s) => s.id === id)
    const toRemove = target?.isAnchor
      ? [
          id,
          ...sourcesRef.current
            .filter((s) => s.parentId === id)
            .map((s) => s.id),
        ]
      : [id]

    for (const rid of toRemove) {
      await deleteSource(rid)
      await deleteLibraryItemsBySource(rid)
      for (const [key, url] of urlCacheRef.current) {
        if (key.startsWith(`${rid}|`)) {
          URL.revokeObjectURL(url)
          urlCacheRef.current.delete(key)
        }
      }
      for (const key of [...fileMapRef.current.keys()]) {
        if (key.startsWith(`${rid}|`)) fileMapRef.current.delete(key)
      }
      handlesRef.current.delete(rid)
    }

    const removeSet = new Set(toRemove)
    setGrantedIds((prev) => {
      const next = new Set(prev)
      for (const rid of toRemove) next.delete(rid)
      return next
    })
    setSources((prev) => prev.filter((s) => !removeSet.has(s.id)))
    setItems((prev) => prev.filter((i) => !removeSet.has(i.sourceId)))
  }, [])

  const renameSource = useCallback((s: SourceUi) => {
    const typed = window.prompt('Yeni ad:', s.label)
    if (typed === null) return
    const label = typed.trim()
    if (!label || label === s.label) return
    const handle = handlesRef.current.get(s.id)
    if (handle) {
      void putSource({
        id: s.id,
        label,
        addedAt: s.addedAt,
        handle,
        parentId: s.parentId,
        subPath: s.subPath,
        isAnchor: s.isAnchor,
        directOnly: s.directOnly,
      })
    }
    setSources((prev) =>
      prev.map((x) => (x.id === s.id ? { ...x, label } : x)),
    )
  }, [])

  const toggleTreeNode = useCallback((anchorId: string, path: string) => {
    const key = `${anchorId}::${path}`
    setExpandedTree((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleNodeSourcesVisible = useCallback(
    (sourceIds: string[], makeVisible: boolean) => {
      setHiddenSourceIds((current) => {
        const next = new Set(current)
        for (const id of sourceIds) {
          if (makeVisible) next.delete(id)
          else next.add(id)
        }
        localStorage.setItem(HIDDEN_SOURCES_KEY, JSON.stringify([...next]))
        return next
      })
    },
    [],
  )

  const renderTreeNode = (
    anchorId: string,
    node: SourceTreeNode,
    depth: number,
  ) => {
    const childSourceIds = collectDescendantSourceIds(node)
    const count = childSourceIds.reduce(
      (sum, id) => sum + (sourceCounts.get(id) ?? 0),
      0,
    )
    const hasKids = node.children.length > 0
    const expandKey = `${anchorId}::${node.path}`
    const expanded = expandedTree.has(expandKey)
    const source = node.source
    const allVisible =
      childSourceIds.length > 0 &&
      childSourceIds.every((id) => !hiddenSourceIds.has(id))
    const activeScans = childSourceIds
      .map((id) => scans.get(id))
      .filter(
        (progress): progress is { done: number; total: number } =>
          progress !== undefined,
      )
    const scanProgress =
      activeScans.length > 0
        ? {
            done: activeScans.reduce((sum, progress) => sum + progress.done, 0),
            total: activeScans.reduce((sum, progress) => sum + progress.total, 0),
          }
        : undefined
    const isScanning = scanProgress !== undefined
    const connected = source
      ? isSourceOnline(
          source,
          sources,
          grantedIds,
          localOnlineIds,
          localAvailabilityReady,
        )
      : true

    return (
      <div key={`${anchorId}:${node.path || node.name}`}>
        <div
          className={`source-row source-row--tree ${source ? '' : 'source-row--virtual'}`}
          style={{ ['--tree-depth' as string]: depth }}
        >
          {hasKids ? (
            <button
              type="button"
              className={`source-row__twist ${expanded ? 'is-open' : ''}`}
              onClick={() => toggleTreeNode(anchorId, node.path)}
              aria-expanded={expanded}
              title={expanded ? 'Daralt' : 'Genişlet'}
            />
          ) : (
            <span className="source-row__twist-spacer" aria-hidden />
          )}

          {childSourceIds.length > 0 ? (
            <input
              type="checkbox"
              className="source-row__pick"
              checked={allVisible}
              onChange={() =>
                toggleNodeSourcesVisible(childSourceIds, !allVisible)
              }
              title="Haritada göster / gizle"
            />
          ) : (
            <span className="source-row__pick-spacer" aria-hidden />
          )}

          {source && (
            <span
              className={`source-row__dot ${connected ? 'is-on' : 'is-off'}`}
              aria-hidden
            />
          )}

          <button
            type="button"
            className={`source-row__name ${hasKids ? 'is-branch' : ''}`}
            title={node.path || node.name}
            onClick={() => {
              if (hasKids) toggleTreeNode(anchorId, node.path)
            }}
          >
            {node.name}
          </button>

          {childSourceIds.length > 0 && (
            <span
              className="source-row__count"
              title="Bu klasördeki medya sayısı"
            >
              {count}
            </span>
          )}

          {isScanning && (
            <span className="source-row__scanning">
              {scanProgress && scanProgress.total > 0
                ? `${scanProgress.done}/${scanProgress.total}`
                : 'Dosyalar aranıyor…'}
            </span>
          )}

          {source &&
            (!isScanning && (connected ? (
              <button
                type="button"
                className="source-row__btn source-row__btn--icon"
                onClick={() => void rescanSource(source.id)}
                title="Yeniden tara"
                aria-label="Yeniden tara"
              >
                ↻
              </button>
            ) : (
              <button
                type="button"
                className="source-row__btn source-row__btn--icon"
                onClick={() => void reconnectSource(source.id)}
                title="Diski bağla / izin ver"
                aria-label="Diski bağla / izin ver"
              >
                ↪
              </button>
             )))}

          {source && (
            <button
              type="button"
              className="source-row__btn source-row__btn--icon source-row__btn--x"
              onClick={() => void removeSource(source.id)}
              title="Bu dalı kaldır"
              disabled={isScanning}
            >
              ×
            </button>
          )}
        </div>
        {hasKids &&
          expanded &&
          node.children.map((child) =>
            renderTreeNode(anchorId, child, depth + 1),
          )}
      </div>
    )
  }

  const renderSourceRow = (s: SourceUi, isChild: boolean) => {
    if (s.isAnchor) {
      const kids = sources.filter((c) => c.parentId === s.id)
      const childCount =
        kids.reduce((sum, c) => sum + (sourceCounts.get(c.id) ?? 0), 0) +
        (sourceCounts.get(s.id) ?? 0)
      const tree = buildSourceTree(kids)
      const rootKey = `${s.id}::`
      const expanded = expandedTree.has(rootKey)
      const hasKids = tree.length > 0
      const rootSource = kids.find((child) => child.subPath === '')
      const rootIsScanning = rootSource ? scans.has(rootSource.id) : false
      const rootIsLocallyLinked = Boolean(rootSource?.localPath) || rootIsScanning

      return (
        <div key={s.id} className="source-tree">
          <div className="source-row source-row--anchor">
            {hasKids ? (
              <button
                type="button"
                className={`source-row__twist ${expanded ? 'is-open' : ''}`}
                onClick={() => toggleTreeNode(s.id, '')}
                aria-expanded={expanded}
                title={expanded ? 'Daralt' : 'Genişlet'}
              />
            ) : (
              <span className="source-row__twist-spacer" aria-hidden />
            )}
            <span className="source-row__pick-spacer" aria-hidden />
            <span className="source-row__drive" aria-hidden>
              💾
            </span>
            <button
              type="button"
              className={`source-row__name source-row__name--anchor ${hasKids ? 'is-branch' : ''}`}
              title={s.label}
              onClick={() => {
                if (hasKids) toggleTreeNode(s.id, '')
              }}
            >
              {s.label}
            </button>
            <span
              className="source-row__count"
              title="Bu sürücüdeki medya sayısı"
            >
              {childCount}
            </span>
            <button
              type="button"
              className="source-row__btn source-row__btn--icon"
              onClick={() => void scanAnchorSource(s.id)}
              title={rootIsLocallyLinked ? 'Yeniden tara' : 'Surucuyu bagla ve tara'}
              aria-label={rootIsLocallyLinked ? 'Yeniden tara' : 'Surucuyu bagla ve tara'}
              disabled={rootIsScanning}
            >
              {rootIsLocallyLinked ? '↻' : '↪'}
            </button>
            <button
              type="button"
              className="source-row__btn source-row__btn--icon"
              onClick={() => renameSource(s)}
              title="Adı değiştir"
              aria-label="Adı değiştir"
            >
              ✎
            </button>
            <button
              type="button"
              className="source-row__btn source-row__btn--icon source-row__btn--x"
              onClick={() => void removeSource(s.id)}
              title="Sürücüyü ve alt dallarını kaldır"
            >
              ×
            </button>
          </div>
          {expanded &&
            tree.map((node) => renderTreeNode(s.id, node, 1))}
        </div>
      )
    }

    const hasLocalPath = Boolean(localPathForSource(s, sources))
    const connected = isSourceOnline(
      s,
      sources,
      grantedIds,
      localOnlineIds,
      localAvailabilityReady,
    )
    const visible = !hiddenSourceIds.has(s.id)
    const count = sourceCounts.get(s.id) ?? 0
    const label = isChild && s.subPath ? s.subPath : s.label
    const scanProgress = scans.get(s.id)
    const isScanning = scanProgress !== undefined

    return (
      <div
        key={s.id}
        className={`source-row ${isChild ? 'source-row--child' : ''}`}
      >
        <span className="source-row__twist-spacer" aria-hidden />
        <input
          type="checkbox"
          className="source-row__pick"
          checked={visible}
          onChange={() => toggleSourceVisible(s.id)}
          title="Haritada göster / gizle"
        />
        <span
          className={`source-row__dot ${connected ? 'is-on' : 'is-off'}`}
          aria-hidden
        />
        <span className="source-row__name" title={label}>
          {label}
        </span>
        <span className="source-row__count" title="Bu kaynaktaki medya sayısı">
          {count}
        </span>
        {isScanning ? (
          <span className="source-row__scanning">
            {scanProgress && scanProgress.total > 0
              ? `${scanProgress.done}/${scanProgress.total}`
              : 'Dosyalar aranıyor…'}
          </span>
        ) : connected && hasLocalPath ? (
          <>
            {!s.directOnly && (
              <button
                type="button"
                className="source-row__btn source-row__btn--icon"
                onClick={() => void expandSourceBranches(s.id)}
                title="Alt klasörleri ağaç dalları olarak keşfet"
                aria-label="Alt klasörleri ağaç dalları olarak keşfet"
              >
                ⑂
              </button>
            )}
            <button
              type="button"
              className="source-row__btn source-row__btn--icon"
              onClick={() => void rescanSource(s.id)}
              title="Yeniden tara"
              aria-label="Yeniden tara"
            >
              ↻
            </button>
          </>
        ) : (
          <button
            type="button"
            className="source-row__btn source-row__btn--icon"
            onClick={() => void reconnectSource(s.id)}
            title="Diski bağla / izin ver"
            aria-label="Diski bağla / izin ver"
          >
            ↪
          </button>
        )}
        <button
          type="button"
          className="source-row__btn source-row__btn--icon"
          onClick={() => renameSource(s)}
          title="Adı değiştir"
          aria-label="Adı değiştir"
        >
          ✎
        </button>
        <button
          type="button"
          className="source-row__btn source-row__btn--icon source-row__btn--x"
          onClick={() => void removeSource(s.id)}
          title="Kaynağı kaldır"
          disabled={isScanning}
        >
          ×
        </button>
      </div>
    )
  }

  const resetAll = useCallback(async () => {
    await clearLibrary()
    for (const url of urlCacheRef.current.values()) URL.revokeObjectURL(url)
    urlCacheRef.current.clear()
    for (const info of thumbCacheRef.current.values()) {
      if (info) URL.revokeObjectURL(info.url)
    }
    thumbCacheRef.current.clear()
    fileMapRef.current.clear()
    handlesRef.current.clear()
    setItems([])
    setSources([])
    setGrantedIds(new Set())
    setViewer(null)
    setSkipped(0)
    setSkippedNames([])
    setCachedCount(0)
    setError('Kütüphane temizlendi.', 'info')
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <p className="brand__mark">
             MedyaAtlas <span className="brand__version">v{__APP_VERSION__}</span>
          </p>
          <p className="brand__tag">
            Dünya haritasında medya izlerin
          </p>
        </div>

        <div className="topbar__actions">
          <button
            type="button"
            hidden
            className="btn btn--primary"
            onClick={() => void addFolderSmart()}
          >
            Klasör ekle
          </button>
          <button hidden
            type="button"
            className="btn"
            onClick={() => setDriveDialogOpen(true)}
            title="Klasörü yerel arka plan hizmetiyle tara"
          >
            Bilgisayardan tara
          </button>
          <button
            type="button"
            hidden
            className="btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Dosya seç
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setSettingsOpen(true)}
          >
            {language === 'en' ? 'Settings' : 'Ayarlar'}
          </button>
          {busy ? (
            <button
              type="button"
              className="btn btn--danger"
              onClick={cancelScan}
              title="Tüm taramaları durdur"
            >
              İptal
            </button>
          ) : (
            (sources.length > 0 || items.length > 0) && (
              <button
                type="button"
                className="btn btn--ghost"
                hidden
                onClick={() => void resetAll()}
                title="Tüm kütüphaneyi ve kaynakları sil"
              >
                Kütüphaneyi temizle
              </button>
            )
          )}
          <input
            ref={folderInputRef}
            type="file"
            hidden
            multiple
            onChange={(e) => {
              void ingest(e.target.files, `${TRANSIENT_PREFIX}${Date.now()}`, false)
              e.target.value = ''
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            hidden
            multiple
            onChange={(e) => {
              void ingest(e.target.files, `${TRANSIENT_PREFIX}${Date.now()}`, false)
              e.target.value = ''
            }}
          />
        </div>
      </header>

      <div className="media-filters" aria-label="Medya türü filtresi">
        <div
          className={`sources-panel sources-panel--inline ${sourcesOpen ? 'is-open' : 'is-collapsed'}`}
          ref={sourcesMenuRef}
        >
          <header className="sources-panel__head">
            <button
              type="button"
              className="sources-panel__toggle"
              onClick={() => setSourcesOpen((open) => !open)}
              aria-expanded={sourcesOpen}
              title={sourcesOpen ? 'Kaynakları gizle' : 'Kaynakları göster'}
            >
              <span className="sources-panel__title">Kaynaklar</span>
              <span className="sources-menu__count">
                {sources.filter((s) => !s.isAnchor).length === 0
                  ? sources.length
                  : `${sources.length - hiddenSourceIds.size}/${sources.length}`}
              </span>
              <span className="sources-panel__caret" aria-hidden>
                {sourcesOpen ? '▾' : '▴'}
              </span>
            </button>
          </header>

          {sourcesOpen && (
            <div className="sources-panel__body">
              {sources.length === 0 ? (
                <p className="sources-menu__hint">
                  Henüz kaynak yok. Sürücü veya klasör ekle.
                </p>
              ) : (
                sources
                  .filter(
                    (s) =>
                      !s.parentId ||
                      !sources.some((p) => p.id === s.parentId),
                  )
                  .map((top) => {
                    if (top.isAnchor) return renderSourceRow(top, false)
                    const children = sources.filter(
                      (c) => c.parentId === top.id,
                    )
                    return (
                      <div key={top.id}>
                        {renderSourceRow(top, false)}
                        {children.map((child) =>
                          renderSourceRow(child, true),
                        )}
                      </div>
                    )
                  })
              )}
              <div className="sources-panel__actions">
                <button
                  type="button"
                  className="sources-menu__action-btn"
                  onClick={() => setDriveDialogOpen(true)}
                >
                  + Sürücü ekle
                </button>
                <button
                  type="button"
                  className="sources-menu__drive-btn"
                  onClick={() => void addFolderSmart()}
                >
                  + Klasör ekle
                </button>
                <button
                  type="button"
                  className="sources-menu__drive-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  + Dosya seç
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className={`types-menu__toggle ${typeMenuLocation === 'located' ? 'is-open' : ''}`}
          onClick={() => {
            setShowLocationMissing(false)
            setTypeMenuLocation((current) => current === 'located' ? null : 'located')
          }}
          title="Haritadaki GPS konumlu medyalar"
        >
          {language === 'en' ? 'GPS located' : 'GPS konumlu'}
          <span className="sources-menu__count">
            {availableItems.filter((item) => !item.locationMissing).length}
          </span>
        </button>
        <button
          type="button"
          className={`types-menu__toggle ${typeMenuLocation === 'missing' ? 'is-open' : ''}`}
          onClick={() => {
            setShowLocationMissing(true)
            setTypeMenuLocation((current) => current === 'missing' ? null : 'missing')
          }}
          title="GPS konumu bulunamayan medyalarÄ± gÃ¶ster"
        >
          {language === 'en' ? 'Location missing' : 'Konum bulunamayan'}
          <span className="sources-menu__count">
            {availableItems.filter((item) => item.locationMissing).length}
          </span>
        </button>

        <div className="types-menu" ref={typesMenuRef}>
          <button
            type="button"
            hidden
            className={`types-menu__toggle ${typeMenuLocation ? 'is-open' : ''}`}
            onClick={() => {
              setTypeMenuLocation((current) => current ? null : 'located')
            }}
            aria-expanded={Boolean(typeMenuLocation)}
          >
            Medya türleri
            <span className="sources-menu__count">
              {enabledKinds.size}/{ALL_KINDS.length}
            </span>
            <span className="sources-menu__caret" aria-hidden>
              ▾
            </span>
          </button>

          {typeMenuLocation && (
            <div className="types-menu__panel">
              {(
                [
                  ['photo', 'Fotoğraflar'],
                  ['video', 'Telefon videoları'],
                  ['gopro', 'GoPro'],
                  ['drone', 'DJI / Drone videoları'],
                ] as const
              ).map(([kind, label]) => (
                <label key={kind} className="types-menu__row">
                  <input
                    type="checkbox"
                    checked={enabledKinds.has(kind)}
                    onChange={() => toggleKind(kind)}
                    disabled={busy}
                  />
                  <span
                    className={`media-filter__dot kind-${kind}`}
                    aria-hidden
                  />
                  <span className="types-menu__label">{label}</span>
                  <span
                    className="types-menu__count"
                    title="Haritadaki alanda görünen sayı"
                  >
                      {availableItems.filter((item) =>
                        item.kind === kind &&
                        (typeMenuLocation === 'missing' ? item.locationMissing : !item.locationMissing),
                      ).length}
                  </span>
                </label>
              ))}
              <p className="types-menu__hint">
                İşaretli türler gösterilir ve sonraki taramada okunur
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          className={`types-menu__toggle ${showLocationMissing ? 'is-open' : ''}`}
          hidden
          onClick={() => setShowLocationMissing((value) => !value)}
          title="GPS konumu bulunamayan medyaları göster"
        >
          Konumu bulunamayan
          <span className="sources-menu__count">
            {availableItems.filter((item) => item.locationMissing).length}
          </span>
        </button>
        <span className="media-filters__hint">
          Geliştiren Ali Dinçer
        </span>
      </div>

      {(busy || items.length > 0) && (
        <div className="status">
          {busy && (
            <p>
              {scans.size > 1 ? `${scans.size} kaynak okunuyor… ` : 'Okunuyor… '}
              {[...scans.values()].reduce((sum, p) => sum + p.done, 0)}/
              {[...scans.values()].reduce((sum, p) => sum + p.total, 0)}
              {' · '}{[...scans.values()].reduce((sum, p) => sum + (p.located ?? 0), 0)} konum bulundu
              {' · '}{[...scans.values()].reduce((sum, p) => sum + (p.missing ?? 0), 0)} konum bulunamadı
              <span className="status__hint"> — durdurmak için İptal</span>
            </p>
          )}
          {!busy && items.length > 0 && (
            <p>
              {availableItems.length !== items.length
                ? `Gösterilen ${availableItems.length} / `
                : ''}
              Toplam {items.length} medya · {locationCount} GPS noktası
              {skipped > 0 ? ` · ${skipped} dosyada GPS yok` : ''}
              {cachedCount > 0 ? ` · ${cachedCount} hafızadan` : ''}
            </p>
          )}
          {!busy && skippedNames.length > 0 && items.length === 0 && (
            <p className="status__hint">
              GPS bulunamayanlar: {skippedNames.slice(0, 8).join(', ')}
              {skippedNames.length > 8 ? ` +${skippedNames.length - 8}` : ''}
            </p>
          )}
        </div>
      )}

      {error && (
        <div
          className="flash-toast-backdrop"
          role="presentation"
          onMouseDown={() => setError(null)}
        >
          <div
            className={`flash-toast flash-toast--${toastKind}`}
            role="alert"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p>{error}</p>
          </div>
        </div>
      )}

      <main className="content">
        <div className="stage">
          <WorldMap
            clusters={clusters}
            onBoundsChange={setMapBounds}
            focusPoint={focusPoint}
          />
          {items.length > 0 && (
            <div className="map-count" title={`Toplam ${locatedCount} GPS’li medya`}>
              <strong>{visibleInArea}</strong> görüntü bu alanda
            </div>
          )}
          {items.length === 0 && !busy && (
            <div className="empty-overlay">
              <h1>Haritada medyalarını göster</h1>
              <p>
                GPS’li fotoğraf, video veya GoPro dosyalarının olduğu klasörü ekle.
                Konumlar haritaya işlenir ve kalıcı kalır; disk takılı olmasa bile
                işaretler görünür. Diski takıp “Bağlan” dediğinde dosyalar açılır.
              </p>
            </div>
          )}

        </div>

        <MediaGallery
          items={galleryItems}
          totalLocated={locatedCount}
          locationMode={showLocationMissing ? 'missing' : 'located'}
          language={language}
          scope={galleryScope}
          onScopeChange={setGalleryScope}
          selectedId={focusedItemId}
          resolveThumb={resolveThumb}
          pathForItem={pathForItem}
          onSelect={(item) => {
            setFocusedItemId(item.id)
            if (item.locationMissing) {
              setError('Bu medyada GPS konumu yok.', 'info')
            }
          }}
          onOpen={(item) => {
            setFocusedItemId(item.id)
            setViewer(item)
          }}
          onReconnect={reconnectSource}
          onCopyPath={copyItemPath}
        />
      </main>

      <Lightbox
        item={viewer}
        resolveUrl={resolveUrl}
        resolveCompatibleVideoUrl={resolveCompatibleVideoUrl}
        revealInFolder={revealInFolder}
        playExternally={playExternally}
        previewEmbed={previewEmbed}
        updatePreviewBounds={updatePreviewBounds}
        stopPreview={stopPreview}
        onClose={() => {
          if (viewer) setFocusedItemId(viewer.id)
          setViewer(null)
        }}
      />

      {notice && (
        <div className="notice-backdrop" role="presentation" onMouseDown={() => setNotice(null)}>
          <section
            className="notice-dialog"
            role="status"
            aria-live="polite"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="notice-dialog__icon" aria-hidden>✓</span>
            <div>
              <h2>{notice.title}</h2>
              <p>{notice.message}</p>
            </div>
            <button type="button" className="btn btn--primary" onClick={() => setNotice(null)}>
              Tamam
            </button>
          </section>
        </div>
      )}

      {driveDialogOpen && (
        <div className="notice-backdrop" role="presentation" onMouseDown={() => setDriveDialogOpen(false)}>
          <form
            className="drive-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              const path = drivePath.trim()
              const letter = driveLetterOf(path)
              if (!path || (letter && addedDriveLetters.has(letter))) return
              setDriveDialogOpen(false)
              void scanLocalPath(path, undefined, driveLabel || undefined)
            }}
          >
            <h2>Sürücü ekle</h2>
            <p>MedyaAtlas bu sürücüyü yalnızca medya dosyalarını taramak ve önizlemeleri açmak için kullanır.</p>
            <label>Bağlı sürücüler</label>
            {drivesLoading && <p className="drive-dialog__status">Sürücüler okunuyor…</p>}
            {drivesError && <p className="drive-dialog__status drive-dialog__status--error">{drivesError}</p>}
            {!drivesLoading && !drivesError && availableDrives.length === 0 && (
              <p className="drive-dialog__status">Bağlı sürücü bulunamadı.</p>
            )}
            <div className="drive-dialog__list" role="listbox" aria-label="Sürücüler">
              {availableDrives.map((drive) => {
                const alreadyAdded = addedDriveLetters.has(drive.letter.toUpperCase())
                return (
                  <button
                    key={drive.path}
                    type="button"
                    role="option"
                    aria-selected={!alreadyAdded && drivePath === drive.path}
                    aria-disabled={alreadyAdded}
                    disabled={alreadyAdded}
                    className={[
                      'drive-dialog__drive',
                      alreadyAdded ? 'is-added' : '',
                      !alreadyAdded && drivePath === drive.path ? 'is-selected' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => {
                      if (alreadyAdded) return
                      setDrivePath(drive.path)
                      setDriveLabel(drive.label)
                    }}
                    onDoubleClick={() => {
                      if (alreadyAdded) return
                      setDrivePath(drive.path)
                      setDriveLabel(drive.label)
                      setDriveDialogOpen(false)
                      void scanLocalPath(drive.path, undefined, drive.label)
                    }}
                  >
                    <span className="drive-dialog__drive-name">{drive.label}</span>
                    <span className="drive-dialog__drive-meta">
                      {alreadyAdded ? <span className="drive-dialog__badge">Eklendi</span> : null}
                      <span className="drive-dialog__drive-path">{drive.path}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="drive-dialog__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setDriveDialogOpen(false)}>Vazgeç</button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={
                  !drivePath.trim()
                  || Boolean(driveLetterOf(drivePath) && addedDriveLetters.has(driveLetterOf(drivePath)!))
                }
              >
                Sürücüyü ekle ve tara
              </button>
            </div>
          </form>
        </div>
      )}

      {settingsOpen && (
        <div
          className="settings-backdrop"
          role="presentation"
          onMouseDown={() => setSettingsOpen(false)}
        >
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="settings-dialog__head">
              <div>
                <p className="settings-dialog__eyebrow">
                  {language === 'en' ? 'MediaAtlas' : 'MedyaAtlas'}
                </p>
                <h2 id="settings-title">
                  {language === 'en' ? 'Settings' : 'Ayarlar'}
                </h2>
              </div>
              <button
                type="button"
                className="settings-dialog__close"
                onClick={() => setSettingsOpen(false)}
                aria-label={language === 'en' ? 'Close' : 'Kapat'}
              >
                ×
              </button>
            </header>

            <div className="settings-dialog__section">
              <label className="settings-dialog__label" htmlFor="language-select">
                {language === 'en' ? 'Language' : 'Dil'}
              </label>
              <select
                id="language-select"
                className="settings-dialog__select"
                value={language}
                onChange={(event) => {
                  const next = event.target.value === 'en' ? 'en' : 'tr'
                  setLanguage(next)
                  localStorage.setItem('mediaatlas-language', next)
                }}
              >
                <option value="tr">Türkçe</option>
                <option value="en">English</option>
              </select>
              <p className="settings-dialog__note">
                {language === 'en'
                  ? 'Main controls switch immediately. More labels will follow in the next beta updates.'
                  : 'Ana kontroller hemen değişir. Kalan metinler sonraki beta güncellemelerinde tamamlanacak.'}
              </p>
            </div>

            <div className="settings-dialog__section">
              <div className="settings-dialog__row">
                <div>
                  <h3>{language === 'en' ? 'Help' : 'Yardım'}</h3>
                  <p>{language === 'en' ? 'How sources and location filters work.' : 'Kaynakların ve konum filtrelerinin nasıl çalıştığı.'}</p>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setHelpOpen((open) => !open)}
                >
                  {helpOpen ? (language === 'en' ? 'Hide' : 'Gizle') : (language === 'en' ? 'Show' : 'Göster')}
                </button>
              </div>
              {helpOpen && (
                <ul className="settings-dialog__help">
                  <li>{language === 'en' ? 'Add a drive from Sources. Its folders are discovered automatically.' : 'Kaynaklar içinden sürücü ekle. Alt klasörler otomatik bulunur.'}</li>
                  <li>{language === 'en' ? 'GPS located media appears on the map; Location missing lists the remaining supported media.' : 'GPS konumlu medya haritada görünür; Konum bulunamayan, desteklenen diğer medyaları listeler.'}</li>
                  <li>{language === 'en' ? 'Use Shift + drag on the map to count media in a selected area.' : 'Haritada Shift basılıyken sürükleyerek seçili alandaki medya sayısını gör.'}</li>
                </ul>
              )}
            </div>

            <div className="settings-dialog__section settings-dialog__section--danger">
              <div className="settings-dialog__row">
                <div>
                  <h3>{language === 'en' ? 'Clear data' : 'Verileri temizle'}</h3>
                  <p>{language === 'en' ? 'Removes the local library, previews and saved sources from this browser.' : 'Bu tarayıcıdaki kütüphaneyi, önizlemeleri ve kayıtlı kaynakları siler.'}</p>
                </div>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => {
                    if (window.confirm(language === 'en' ? 'Clear all MediaAtlas data on this browser?' : 'Bu tarayıcıdaki tüm MedyaAtlas verileri silinsin mi?')) {
                      void resetAll()
                      setSettingsOpen(false)
                    }
                  }}
                >
                  {language === 'en' ? 'Clear data' : 'Verileri temizle'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
