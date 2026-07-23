import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WorldMap, type MapBounds } from './components/WorldMap'
import { MediaGallery } from './components/MediaGallery'
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
  if (getExtension(name) === 'xmp' || getExtension(name) === 'srt') return true
  const kind = detectKind(name)
  return kind !== null && kinds.has(kind)
}

/** Kaynak keşfi, ekrandaki tür filtresinden bağımsız tüm desteklenen medyayı görür. */
function isSupportedMediaFileName(name: string): boolean {
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
  }
}

export default function App() {
  const [items, setItems] = useState<MediaItem[]>([])
  const [enabledKinds, setEnabledKinds] = useState<Set<MediaKind>>(loadFilters)
  const [sources, setSources] = useState<SourceUi[]>([])
  const [grantedIds, setGrantedIds] = useState<Set<string>>(new Set())
  const [hiddenSourceIds, setHiddenSourceIds] =
    useState<Set<string>>(loadHiddenSources)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [typesOpen, setTypesOpen] = useState(false)
  /** Açık ağaç düğümleri: `${anchorId}::${path}` */
  const [expandedTree, setExpandedTree] = useState<Set<string>>(() => new Set())
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null)
  const [viewer, setViewer] = useState<MediaItem | null>(null)
  // Kaynak başına eşzamanlı tarama ilerlemesi
  const [scans, setScans] = useState<Map<string, { done: number; total: number }>>(
    () => new Map(),
  )
  const [skipped, setSkipped] = useState(0)
  const [skippedNames, setSkippedNames] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cachedCount, setCachedCount] = useState(0)

  const busy = scans.size > 0
  const selectableSourceIds = sources.filter((s) => !s.isAnchor).map((s) => s.id)
  const allSourcesVisible =
    selectableSourceIds.length > 0 &&
    selectableSourceIds.every((id) => !hiddenSourceIds.has(id))

  const folderInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sourcesMenuRef = useRef<HTMLDivElement>(null)
  const typesMenuRef = useRef<HTMLDivElement>(null)
  const scanControllersRef = useRef<Map<string, AbortController>>(new Map())
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

  // Kaynak erişimi + seçili tür ve kaynak filtreleri
  const availableItems = useMemo(
    () =>
      items
        .filter(
          (it) =>
            enabledKinds.has(it.kind) && !hiddenSourceIds.has(it.sourceId),
        )
        .map((it) => ({ ...it, available: grantedIds.has(it.sourceId) })),
    [items, grantedIds, enabledKinds, hiddenSourceIds],
  )
  const clusters = useMemo(() => groupByLocation(availableItems), [availableItems])

  // O anki harita alanındaki öğeler (tür/kaynak filtresi uygulanmadan);
  // menülerdeki sayılar görünen alanı yansıtır.
  const boundedItems = useMemo(() => {
    if (!mapBounds) return items
    return items.filter((i) => inBounds(i.latitude, i.longitude, mapBounds))
  }, [items, mapBounds])

  // Tür başına, haritada görünen alandaki görüntü sayısı
  const kindCounts = useMemo(() => {
    const counts = new Map<MediaKind, number>()
    for (const it of boundedItems) {
      counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1)
    }
    return counts
  }, [boundedItems])

  // Kaynak başına, haritada görünen alandaki görüntü sayısı
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const it of boundedItems) {
      counts.set(it.sourceId, (counts.get(it.sourceId) ?? 0) + 1)
    }
    return counts
  }, [boundedItems])

  // Haritada o an görünen alandaki medya, en yeni tarih üstte
  const visibleItems = useMemo(() => {
    if (!mapBounds) return []
    return availableItems
      .filter((i) => inBounds(i.latitude, i.longitude, mapBounds))
      .sort((a, b) => {
        if (a.takenAt && b.takenAt) return b.takenAt.getTime() - a.takenAt.getTime()
        if (a.takenAt) return -1
        if (b.takenAt) return 1
        return a.name.localeCompare(b.name)
      })
  }, [availableItems, mapBounds])

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
    if (!typesOpen) return
    const onDown = (e: MouseEvent) => {
      if (!typesMenuRef.current?.contains(e.target as Node)) {
        setTypesOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [typesOpen])

  // Açılışta kalıcı kütüphaneyi ve kaynakları yükle (tarama yok)
  useEffect(() => {
    void (async () => {
      const [srcs, rawLib] = await Promise.all([getSources(), getLibraryItems()])

      // LRV'ler değerlendirme dışı: eski kayıtları da temizle
       const invalidItems = rawLib.filter(
         (l) =>
           l.name.toLowerCase().endsWith('.lrv') ||
           isNullIslandCoordinate(l.latitude, l.longitude),
       )
       if (invalidItems.length > 0) {
         await deleteLibraryItems(invalidItems.map((l) => l.id))
       }
       const lib = rawLib.filter(
         (l) =>
           !l.name.toLowerCase().endsWith('.lrv') &&
           !isNullIslandCoordinate(l.latitude, l.longitude),
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
      }))
      setSources(
        srcs
          .map((s) => ({
            id: s.id,
            label: s.label,
            addedAt: s.addedAt,
            parentId: s.parentId,
             subPath: s.subPath,
             localPath: s.localPath,
             isAnchor: s.isAnchor,
            directOnly: s.directOnly,
          }))
          .sort((a, b) => a.addedAt - b.addedAt),
      )
       // Her açılışta sade başla: yalnız sürücü adları görünür olsun.
       setExpandedTree(new Set())
       setSourcesOpen(false)
      setGrantedIds(granted)
      setItems(loaded)
    })()
  }, [])

  const cancelScan = useCallback(() => {
    for (const controller of scanControllersRef.current.values()) {
      controller.abort()
    }
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
      if (item.url) return item.url
      const cached = urlCacheRef.current.get(item.id)
      if (cached) return cached

      const file = await resolveFile(item)
      if (!file) return null
      const url = URL.createObjectURL(file)
      urlCacheRef.current.set(item.id, url)
      return url
    },
    [resolveFile],
  )

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
        () => setError(`Yol kopyalandı: ${text}`),
        () => setError('Yol kopyalanamadı.'),
      )
    },
    [pathForItem],
  )

  /**
   * Küçük önizleme: önce bellek, sonra IndexedDB; yoksa dosyadan bir kez
   * üretilir ve kalıcı saklanır. Galeri asla tam boy video/foto açmaz.
   */
  const resolveThumb = useCallback(
    async (item: MediaItem): Promise<ThumbInfo | null> => {
      const inMemory = thumbCacheRef.current.get(item.id)
      if (inMemory !== undefined) return inMemory
      if (item.url && item.kind === 'photo') {
        const info = { url: item.url }
        thumbCacheRef.current.set(item.id, info)
        return info
      }
      const pending = thumbPendingRef.current.get(item.id)
      if (pending) return pending

      const task = (async (): Promise<ThumbInfo | null> => {
        const stored = await getThumb(item.id)
        if (stored) {
          const info: ThumbInfo = {
            url: URL.createObjectURL(stored.blob),
            durationSec: stored.durationSec,
          }
          thumbCacheRef.current.set(item.id, info)
          return info
        }

        const file = await resolveFile(item)
        if (!file) return null

        const generated = await generateThumb(file, item.kind)
        if (!generated) {
          thumbCacheRef.current.set(item.id, null)
          return null
        }

        await putThumb({
          id: item.id,
          blob: generated.blob,
          durationSec: generated.durationSec,
        })
        const info: ThumbInfo = {
          url: URL.createObjectURL(generated.blob),
          durationSec: generated.durationSec,
        }
        thumbCacheRef.current.set(item.id, info)
        return info
      })()
      thumbPendingRef.current.set(item.id, task)
      try {
        return await task
      } finally {
        thumbPendingRef.current.delete(item.id)
      }
    },
    [resolveFile],
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

      const files = await readFilesFromHandle(handle, (name) =>
        acceptsFileName(name, enabledKindsRef.current),
      )
      await ingest(files, sourceId, true)
    } catch (e) {
      setError(friendlyError(e, 'Klasör eklenemedi.'))
    }
  }, [ingest])

  const scanLocalPath = useCallback(async (existingPath?: string, existingId?: string) => {
    const path = existingPath ?? window.prompt('Taranacak klasör ya da sürücü yolu:', 'F:\\')
    if (!path?.trim()) return
    const sourceId = existingId ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const label = path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || path
    setError(null)
    setSourcesOpen(true)
    setScans((prev) => new Map(prev).set(sourceId, { done: 0, total: 0 }))
    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, sourceId }),
      })
      const data = await response.json() as {
        error?: string
        items?: Array<Omit<MediaItem, 'takenAt'> & { takenAt?: string }>
      }
      if (!response.ok || !data.items) throw new Error(data.error || 'Yerel tarama başlatılamadı.')
      const next = data.items.map((item) => ({
        ...item,
        takenAt: item.takenAt ? new Date(item.takenAt) : undefined,
      }))
      setSources((prev) => [
        ...prev.filter((source) => source.id !== sourceId),
        {
          ...(sourcesRef.current.find((source) => source.id === sourceId) ?? {}),
          id: sourceId,
          label,
          localPath: path,
          addedAt: Date.now(),
        },
      ])
      // Eski tarayici kaynagini bir kez yerel yola bagladigimizda bu bilgiyi
      // IndexedDB'ye de yaz. Sonraki "Tara" tiklamalari Chrome taramasina
      // donmez; arka plandaki yerel hizmet kullanilir.
      const existingSource = sourcesRef.current.find((source) => source.id === sourceId)
      const existingHandle = handlesRef.current.get(sourceId)
      if (existingSource && existingHandle) {
        await putSource({
          id: sourceId,
          label,
          addedAt: existingSource.addedAt,
          handle: existingHandle,
          localPath: path,
          parentId: existingSource.parentId,
          subPath: existingSource.subPath,
          isAnchor: existingSource.isAnchor,
          directOnly: existingSource.directOnly,
        })
      }
      setItems((prev) => [...prev.filter((item) => item.sourceId !== sourceId), ...next])
      setGrantedIds((prev) => new Set(prev).add(sourceId))
      setSkipped(Math.max(0, (data.items?.length ?? 0)))
      setViewer(null)
    } catch (e) {
      setError(friendlyError(e, 'Yerel klasör taranamadı.'))
    } finally {
      setScans((prev) => {
        const next = new Map(prev)
        next.delete(sourceId)
        return next
      })
    }
  }, [])

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

        setError(`"${source.label}" altında medyalı klasörler aranıyor…`)
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

      setError(`"${driveLabel}" taranıyor: medyalı klasörler aranıyor…`)
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
        const drive = /\(([A-Za-z]):\)/.exec(source.label)
        const path = source.localPath ?? window.prompt(
          `"${source.label}" icin klasor ya da surucu yolu:`,
          drive ? `${drive[1]}:\\` : '',
        )
        if (!path?.trim()) return
        await scanLocalPath(path, id)
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
        const drive = /\(([A-Za-z]):\)/.exec(source.label)
        const path = source.localPath ?? window.prompt(
          `"${source.label}" icin klasor ya da surucu yolu:`,
          drive ? `${drive[1]}:\\` : '',
        )
        if (!path?.trim()) return
        await scanLocalPath(path, id)
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

  // Surucu satiri bir grup basligidir. Buna da bagla/tara eylemi veriyoruz;
  // tarama sonucu basligin altindaki "(kok)" dali olarak gorunur.
  const scanAnchorSource = useCallback(async (anchorId: string) => {
    const anchor = sourcesRef.current.find((source) => source.id === anchorId)
    if (!anchor) return

    const existingRoot = sourcesRef.current.find(
      (source) => source.parentId === anchorId && source.subPath === '',
    )
    const drive = /\(([A-Za-z]):\)/.exec(anchor.label)
    const path = existingRoot?.localPath ?? window.prompt(
      `"${anchor.label}" icin klasor ya da surucu yolu:`,
      drive ? `${drive[1]}:\\` : '',
    )
    if (!path?.trim()) return

    if (existingRoot) {
      await scanLocalPath(path, existingRoot.id)
      return
    }

    const handle = handlesRef.current.get(anchorId)
    if (!handle) {
      setError('Surucu kaydi bulunamadi. Lutfen kaynak listesinden yeniden ekle.')
      return
    }
    const rootId = `src-root-${anchorId}`
    const root: SourceUi = {
      id: rootId,
      label: '(kok)',
      addedAt: Date.now(),
      localPath: path,
      parentId: anchorId,
      subPath: '',
    }
    handlesRef.current.set(rootId, handle)
    sourcesRef.current = [...sourcesRef.current, root]
    setSources((prev) => [...prev, root])
    await putSource({
      id: rootId,
      label: root.label,
      addedAt: root.addedAt,
      handle,
      localPath: path,
      parentId: anchorId,
      subPath: '',
    })
    await scanLocalPath(path, rootId)
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
    const connected = source ? grantedIds.has(source.id) : true

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
              title="Haritadaki alanda görünen sayı"
            >
              {count}
            </span>
          )}

          {isScanning && (
            <span className="source-row__scanning">
              {scanProgress ? `${scanProgress.done}/${scanProgress.total}` : 'Okunuyor…'}
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
      const childCount = kids.reduce(
        (sum, c) => sum + (sourceCounts.get(c.id) ?? 0),
        0,
      )
      const tree = buildSourceTree(kids)
      const rootKey = `${s.id}::`
      const expanded = expandedTree.has(rootKey)
      const hasKids = tree.length > 0

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
              title="Haritadaki alanda görünen sayı"
            >
              {childCount}
            </span>
            <button
              type="button"
              className="source-row__btn source-row__btn--icon"
              onClick={() => void scanAnchorSource(s.id)}
              title="Surucuyu bagla ve tara"
              aria-label="Surucuyu bagla ve tara"
            >
              ↪
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

    const connected = grantedIds.has(s.id)
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
        <span className="source-row__count" title="Haritadaki alanda görünen sayı">
          {count}
        </span>
        {isScanning ? (
          <span className="source-row__scanning">
            {scanProgress ? `${scanProgress.done}/${scanProgress.total}` : 'Okunuyor…'}
          </span>
        ) : connected ? (
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
    setError('Kütüphane temizlendi.')
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <p className="brand__mark">
            MedyaAtlas <span className="brand__version">v0.1.32-beta</span>
          </p>
          <p className="brand__tag">
            Dünya haritasında medya izlerin
          </p>
        </div>

        <div className="topbar__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void addFolder()}
          >
            Klasör ekle
          </button>
          <button hidden
            type="button"
            className="btn"
            onClick={() => void scanLocalPath()}
            title="Klasörü yerel arka plan hizmetiyle tara"
          >
            Bilgisayardan tara
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Dosya seç
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
              <div className="sources-panel__selection">
                <button
                  type="button"
                  className="sources-panel__selection-btn"
                  onClick={() =>
                    toggleNodeSourcesVisible(
                      selectableSourceIds,
                      !allSourcesVisible,
                    )
                  }
                  disabled={selectableSourceIds.length === 0}
                >
                  {allSourcesVisible ? 'Tümünü bırak' : 'Tümünü seç'}
                </button>
              </div>
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
                  className="sources-menu__drive-btn"
                  onClick={() => void scanLocalPath()}
                >
                  + Yerel yol tara
                </button>
                <button
                  type="button"
                  className="sources-menu__action-btn"
                  onClick={() => void rescanAll()}
                  title="Bağlı tüm klasörleri yeniden tara"
                  disabled={
                    !sources.some((s) => !s.isAnchor && grantedIds.has(s.id))
                  }
                >
                  Tümünü tara / güncelle
                </button>
                <button
                  type="button"
                  className="sources-menu__drive-btn"
                  onClick={() => void registerDrive()}
                  title="Sürücü ekle; medyalı klasörler otomatik dal olur"
                >
                  + Sürücü ekle
                </button>
              </div>
              <p className="sources-menu__hint">
                ▸ dalı açar · kutu haritada gösterir. Eski tek klasörde “Dallar”.
              </p>
            </div>
          )}
        </div>

        <div className="types-menu" ref={typesMenuRef}>
          <button
            type="button"
            className={`types-menu__toggle ${typesOpen ? 'is-open' : ''}`}
            onClick={() => setTypesOpen((open) => !open)}
            aria-expanded={typesOpen}
          >
            Medya türleri
            <span className="sources-menu__count">
              {enabledKinds.size}/{ALL_KINDS.length}
            </span>
            <span className="sources-menu__caret" aria-hidden>
              ▾
            </span>
          </button>

          {typesOpen && (
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
                    {kindCounts.get(kind) ?? 0}
                  </span>
                </label>
              ))}
              <p className="types-menu__hint">
                İşaretli türler gösterilir ve sonraki taramada okunur
              </p>
            </div>
          )}
        </div>
        <span className="media-filters__hint">
          Geliştiren Ali Dinçer
        </span>
      </div>

      {(busy || error || items.length > 0) && (
        <div className="status">
          {busy && (
            <p>
              {scans.size > 1 ? `${scans.size} kaynak okunuyor… ` : 'Okunuyor… '}
              {[...scans.values()].reduce((sum, p) => sum + p.done, 0)}/
              {[...scans.values()].reduce((sum, p) => sum + p.total, 0)}
              <span className="status__hint"> — durdurmak için İptal</span>
            </p>
          )}
          {!busy && items.length > 0 && (
            <p>
              {availableItems.length !== items.length
                ? `Gösterilen ${availableItems.length} / `
                : ''}
              Toplam {items.length} medya · {clusters.length} konum
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
          {error && (
            <div className="status__error" role="alert">
              <p>{error}</p>
              <button
                type="button"
                className="status__error-close"
                onClick={() => setError(null)}
                title="Uyarıyı kapat"
                aria-label="Uyarıyı kapat"
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}

      <main className="content">
        <div className="stage">
          <WorldMap clusters={clusters} onBoundsChange={setMapBounds} />
          {items.length > 0 && (
            <div className="map-count" title={`Toplam ${items.length} medya`}>
              <strong>{visibleItems.length}</strong> görüntü bu alanda
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
          items={visibleItems}
          resolveThumb={resolveThumb}
          pathForItem={pathForItem}
          onOpen={setViewer}
          onReconnect={reconnectSource}
          onCopyPath={copyItemPath}
        />
      </main>

      <Lightbox
        item={viewer}
        resolveUrl={resolveUrl}
        onClose={() => setViewer(null)}
      />
    </div>
  )
}
