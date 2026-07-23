import type { MediaKind } from '../types'

const DB_NAME = 'konumnerede'
const DB_VERSION = 3
const GPS_STORE = 'gps'
const HANDLE_STORE = 'handles'
const SOURCE_STORE = 'sources'
const LIBRARY_STORE = 'library'
const THUMB_STORE = 'thumbs'
const LAST_DIR_KEY = 'lastDir'
const GOPRO_FILE_NAME = /^(gopr|g[xhs]\d{6}|gpfr|gp\d{6}|go\d{6})/i
const PHOTO_FILE_NAME = /\.(jpe?g|png|webp|heic|heif|tiff?|dng|gpr|arw|cr2|nef|orf|raf|rw2)$/i

export interface CachedGps {
  sig: string
  hasGps: boolean
  latitude?: number
  longitude?: number
  takenAt?: number
  kind?: MediaKind
  width?: number
  height?: number
}

/** Kalıcı kaynak (disk/klasör). Handle IndexedDB'de saklanır. */
export interface SourceRecord {
  id: string
  label: string
  addedAt: number
  handle: FileSystemDirectoryHandle
  /** Bağlı olduğu sürücü kökü (çapa) kaynağının kimliği. */
  parentId?: string
  /** Çapaya göre alt yol, ör. "DCIM/100GOPRO". */
  subPath?: string
  /** Sürücü kökü çapası: taranmaz, sadece gruplama sağlar. */
  isAnchor?: boolean
  /**
   * true: yalnızca bu klasördeki dosyalar taranır (alt klasörler ayrı dal).
   * Sürücü keşfiyle eklenen dallarda kullanılır; mükerrer GPS önlenir.
   */
  directOnly?: boolean
}

/** Kalıcı kütüphane kaydı: dosya taramasız haritada görünür. */
export interface LibraryItem {
  id: string
  sourceId: string
  relativePath: string
  name: string
  kind: MediaKind
  latitude: number
  longitude: number
  takenAt?: number
  width?: number
  height?: number
}

/** Bir kez üretilen küçük önizleme; video her seferinde yeniden açılmaz. */
export interface ThumbRecord {
  id: string
  blob: Blob
  durationSec?: number
}

let dbPromise: Promise<IDBDatabase | null> | null = null
let gpsMemory: Map<string, CachedGps> | null = null
let gpsMemoryLoading: Promise<Map<string, CachedGps>> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(GPS_STORE)) {
        db.createObjectStore(GPS_STORE, { keyPath: 'sig' })
      }
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE)
      }
      if (!db.objectStoreNames.contains(SOURCE_STORE)) {
        db.createObjectStore(SOURCE_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(LIBRARY_STORE)) {
        const store = db.createObjectStore(LIBRARY_STORE, { keyPath: 'id' })
        store.createIndex('sourceId', 'sourceId', { unique: false })
      }
      if (!db.objectStoreNames.contains(THUMB_STORE)) {
        db.createObjectStore(THUMB_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
  return dbPromise
}

/** Dosya kimliği: ad + boyut + değiştirilme zamanı. */
export function fileSignature(file: File): string {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  const baseName = file.name.replace(/\.[^.]+$/, '')
  // GoPro/Max 360 okuyucusu güncellendiğinde eski "GPS yok" kayıtları
  // yeniden denenmelidir.
  const version = /^DJI[_-].*\.(mp4|mov)$/i.test(file.name)
    ? 'v3-dji'
    : GOPRO_FILE_NAME.test(baseName)
      ? 'v8-gopro-gps'
      : PHOTO_FILE_NAME.test(file.name)
        ? 'v8-photo-exif-fallback'
      : 'v7-fast-skip'
  return `${version}|${path || file.name}|${file.size}|${file.lastModified}`
}

export async function getCachedGps(sig: string): Promise<CachedGps | null> {
  if (gpsMemory) return gpsMemory.get(sig) ?? null
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    const tx = db.transaction(GPS_STORE, 'readonly')
    const req = tx.objectStore(GPS_STORE).get(sig)
    req.onsuccess = () => resolve((req.result as CachedGps) ?? null)
    req.onerror = () => resolve(null)
  })
}

/**
 * SÃ¼rÃ¼cÃ¼ yenilemesinde her dosya iÃ§in ayrÄ± IndexedDB iÅŸlemi baÅŸlatmak
 * mekanik disklerde Ã§ok yavaÅŸtÄ±r. Ã–nbelleÄŸi bir kez belleÄŸe alÄ±r; aynÄ±
 * anda baÅŸlayan kaynak taramalarÄ± da bu tek okumayÄ± paylaÅŸÄ±r.
 */
export async function getGpsCacheSnapshot(): Promise<Map<string, CachedGps>> {
  if (gpsMemory) return gpsMemory
  if (gpsMemoryLoading) return gpsMemoryLoading

  gpsMemoryLoading = (async () => {
    const db = await openDb()
    if (!db) return new Map<string, CachedGps>()
    const entries = await new Promise<CachedGps[]>((resolve) => {
      const tx = db.transaction(GPS_STORE, 'readonly')
      const req = tx.objectStore(GPS_STORE).getAll()
      req.onsuccess = () => resolve((req.result as CachedGps[]) ?? [])
      req.onerror = () => resolve([])
    })
    const snapshot = new Map(entries.map((entry) => [entry.sig, entry]))
    gpsMemory = snapshot
    return snapshot
  })()

  try {
    return await gpsMemoryLoading
  } finally {
    gpsMemoryLoading = null
  }
}

export async function putCachedGps(entry: CachedGps): Promise<void> {
  gpsMemory?.set(entry.sig, entry)
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    const tx = db.transaction(GPS_STORE, 'readwrite')
    tx.objectStore(GPS_STORE).put(entry)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function clearGpsCache(): Promise<void> {
  gpsMemory?.clear()
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    const tx = db.transaction(GPS_STORE, 'readwrite')
    tx.objectStore(GPS_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

// ---- Kaynaklar (diskler/klasörler) ----

export async function getSources(): Promise<SourceRecord[]> {
  const db = await openDb()
  if (!db) return []
  return new Promise((resolve) => {
    const tx = db.transaction(SOURCE_STORE, 'readonly')
    const req = tx.objectStore(SOURCE_STORE).getAll()
    req.onsuccess = () => resolve((req.result as SourceRecord[]) ?? [])
    req.onerror = () => resolve([])
  })
}

export async function putSource(record: SourceRecord): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    const tx = db.transaction(SOURCE_STORE, 'readwrite')
    tx.objectStore(SOURCE_STORE).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function deleteSource(id: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    const tx = db.transaction(SOURCE_STORE, 'readwrite')
    tx.objectStore(SOURCE_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

// ---- Kütüphane (haritadaki kalıcı kayıtlar) ----

export async function getLibraryItems(): Promise<LibraryItem[]> {
  const db = await openDb()
  if (!db) return []
  return new Promise((resolve) => {
    const tx = db.transaction(LIBRARY_STORE, 'readonly')
    const req = tx.objectStore(LIBRARY_STORE).getAll()
    req.onsuccess = () => resolve((req.result as LibraryItem[]) ?? [])
    req.onerror = () => resolve([])
  })
}

export async function putLibraryItems(items: LibraryItem[]): Promise<void> {
  const db = await openDb()
  if (!db || items.length === 0) return
  return new Promise((resolve) => {
    const tx = db.transaction(LIBRARY_STORE, 'readwrite')
    const store = tx.objectStore(LIBRARY_STORE)
    for (const item of items) store.put(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function deleteLibraryItems(ids: string[]): Promise<void> {
  const db = await openDb()
  if (!db || ids.length === 0) return
  return new Promise((resolve) => {
    const tx = db.transaction(LIBRARY_STORE, 'readwrite')
    const store = tx.objectStore(LIBRARY_STORE)
    for (const id of ids) store.delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function deleteLibraryItemsBySource(sourceId: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    const tx = db.transaction(LIBRARY_STORE, 'readwrite')
    const index = tx.objectStore(LIBRARY_STORE).index('sourceId')
    const req = index.openKeyCursor(IDBKeyRange.only(sourceId))
    req.onsuccess = () => {
      const cursor = req.result
      if (cursor) {
        tx.objectStore(LIBRARY_STORE).delete(cursor.primaryKey)
        cursor.continue()
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function clearLibrary(): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    const tx = db.transaction(
      [LIBRARY_STORE, SOURCE_STORE, THUMB_STORE],
      'readwrite',
    )
    tx.objectStore(LIBRARY_STORE).clear()
    tx.objectStore(SOURCE_STORE).clear()
    tx.objectStore(THUMB_STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function getThumb(id: string): Promise<ThumbRecord | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    const tx = db.transaction(THUMB_STORE, 'readonly')
    const req = tx.objectStore(THUMB_STORE).get(id)
    req.onsuccess = () => resolve((req.result as ThumbRecord) ?? null)
    req.onerror = () => resolve(null)
  })
}

export async function putThumb(record: ThumbRecord): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    const tx = db.transaction(THUMB_STORE, 'readwrite')
    tx.objectStore(THUMB_STORE).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function saveLastDirHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite')
    tx.objectStore(HANDLE_STORE).put(handle, LAST_DIR_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function getLastDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    const tx = db.transaction(HANDLE_STORE, 'readonly')
    const req = tx.objectStore(HANDLE_STORE).get(LAST_DIR_KEY)
    req.onsuccess = () =>
      resolve((req.result as FileSystemDirectoryHandle) ?? null)
    req.onerror = () => resolve(null)
  })
}
