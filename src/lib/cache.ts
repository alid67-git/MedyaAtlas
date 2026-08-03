import type { MediaKind } from '../types'
import type { MapTrack } from './tracks'

const DB_NAME = 'konumnerede'
const DB_VERSION = 4
const GPS_STORE = 'gps'
const HANDLE_STORE = 'handles'
const SOURCE_STORE = 'sources'
const LIBRARY_STORE = 'library'
const THUMB_STORE = 'thumbs'
const TRACK_STORE = 'tracks'
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
  locationMissing?: boolean
  /** GoPro: GPMF çıkarma başarısız (yeniden denenebilir). */
  gpsExtractFailed?: boolean
}

/** Kalıcı kaynak (disk/klasör). Handle IndexedDB'de saklanır. */
export interface SourceRecord {
  id: string
  label: string
  addedAt: number
  /** Klasör seçiciyle eklenenlerde var; yalnızca yol ile eklenenlerde olmayabilir. */
  handle?: FileSystemDirectoryHandle
  /** Yerel arka plan hizmetinin doğrudan tarayacağı klasör yolu. */
  localPath?: string
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
  locationMissing?: boolean
  gpsExtractFailed?: boolean
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

function resetDbConnection(): void {
  dbPromise = null
}

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
      if (!db.objectStoreNames.contains(TRACK_STORE)) {
        db.createObjectStore(TRACK_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      db.onclose = () => resetDbConnection()
      db.onversionchange = () => {
        try {
          db.close()
        } catch {
          /* */
        }
        resetDbConnection()
      }
      resolve(db)
    }
    req.onerror = () => {
      resetDbConnection()
      resolve(null)
    }
    req.onblocked = () => {
      /* başka sekme yükseltmesi */
    }
  })
  return dbPromise
}

function isIdbClosingError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  return (
    /connection is closing/i.test(msg) ||
    /InvalidStateError/i.test(msg) ||
    /database connection is closing/i.test(msg)
  )
}

/** Kapalı bağlantıda bir kez yeniden açıp dene (Safari / telefon). */
async function withDb<T>(
  run: (db: IDBDatabase) => Promise<T>,
): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const db = await openDb()
      if (!db) return null
      return await run(db)
    } catch (error) {
      if (attempt === 0 && isIdbClosingError(error)) {
        resetDbConnection()
        continue
      }
      return null
    }
  }
  return null
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

/** Dosya kimliği: ad + boyut + değiştirilme zamanı. */
export function fileSignature(file: File): string {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  const baseName = file.name.replace(/\.[^.]+$/, '')
  // GoPro seyrek GPMF okuyucu: eski "GPS yok" kayıtlarını bir kez yeniden dene.
  const version = /^DJI[_-].*\.(mp4|mov)$/i.test(file.name)
    ? 'v3-dji'
    : GOPRO_FILE_NAME.test(baseName)
      ? 'v11-gopro-retryable'
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

function sourceMeta(record: SourceRecord): Omit<SourceRecord, 'handle'> & { id: string } {
  const { handle: _handle, ...meta } = record
  return meta
}

export async function getSources(): Promise<SourceRecord[]> {
  const db = await openDb()
  if (!db) return []
  return new Promise((resolve) => {
    const tx = db.transaction([SOURCE_STORE, HANDLE_STORE], 'readonly')
    const req = tx.objectStore(SOURCE_STORE).getAll()
    req.onsuccess = () => {
      const rows = (req.result as SourceRecord[]) ?? []
      if (rows.length === 0) {
        resolve([])
        return
      }
      const handleStore = tx.objectStore(HANDLE_STORE)
      const out: SourceRecord[] = new Array(rows.length)
      let pending = rows.length
      rows.forEach((row, index) => {
        const meta = sourceMeta(row)
        const hReq = handleStore.get(row.id)
        hReq.onsuccess = () => {
          const handle =
            (hReq.result as FileSystemDirectoryHandle | undefined) ?? row.handle
          out[index] = handle ? { ...meta, handle } : meta
          pending -= 1
          if (pending === 0) resolve(out)
        }
        hReq.onerror = () => {
          out[index] = meta
          pending -= 1
          if (pending === 0) resolve(out)
        }
      })
    }
    req.onerror = () => resolve([])
  })
}

export async function putSource(record: SourceRecord): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    const tx = db.transaction([SOURCE_STORE, HANDLE_STORE], 'readwrite')
    // Handle ayrı store'da: bazı ortamlarda SourceRecord içinde clone başarısız olur
    // ve tüm kayıt silinir / yazılmaz.
    tx.objectStore(SOURCE_STORE).put(sourceMeta(record))
    if (record.handle) {
      tx.objectStore(HANDLE_STORE).put(record.handle, record.id)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function deleteSource(id: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    const tx = db.transaction([SOURCE_STORE, HANDLE_STORE], 'readwrite')
    tx.objectStore(SOURCE_STORE).delete(id)
    tx.objectStore(HANDLE_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

// ---- Kütüphane (haritadaki kalıcı kayıtlar) ----

export async function getLibraryItems(): Promise<LibraryItem[]> {
  const result = await withDb(
    (db) =>
      new Promise<LibraryItem[]>((resolve, reject) => {
        try {
          const tx = db.transaction(LIBRARY_STORE, 'readonly')
          const req = tx.objectStore(LIBRARY_STORE).getAll()
          req.onsuccess = () => resolve((req.result as LibraryItem[]) ?? [])
          req.onerror = () => resolve([])
        } catch (error) {
          reject(error)
        }
      }),
  )
  return result ?? []
}

export async function putLibraryItems(items: LibraryItem[]): Promise<void> {
  if (items.length === 0) return
  await withDb(async (db) => {
    const tx = db.transaction(LIBRARY_STORE, 'readwrite')
    const store = tx.objectStore(LIBRARY_STORE)
    for (const item of items) store.put(item)
    await txDone(tx)
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
      [LIBRARY_STORE, SOURCE_STORE, THUMB_STORE, HANDLE_STORE],
      'readwrite',
    )
    tx.objectStore(LIBRARY_STORE).clear()
    tx.objectStore(SOURCE_STORE).clear()
    tx.objectStore(THUMB_STORE).clear()
    // lastDir anahtarını koru; yalnızca kaynak handle'larını sil
    const handles = tx.objectStore(HANDLE_STORE)
    const req = handles.getAllKeys()
    req.onsuccess = () => {
      for (const key of (req.result as IDBValidKey[]) ?? []) {
        if (key !== LAST_DIR_KEY) handles.delete(key)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

export async function getThumb(id: string): Promise<ThumbRecord | null> {
  return withDb(
    (db) =>
      new Promise<ThumbRecord | null>((resolve, reject) => {
        try {
          const tx = db.transaction(THUMB_STORE, 'readonly')
          const req = tx.objectStore(THUMB_STORE).get(id)
          req.onsuccess = () => resolve((req.result as ThumbRecord) ?? null)
          req.onerror = () => resolve(null)
        } catch (error) {
          reject(error)
        }
      }),
  )
}

export async function putThumb(record: ThumbRecord): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(THUMB_STORE, 'readwrite')
    tx.objectStore(THUMB_STORE).put(record)
    await txDone(tx)
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

// ---- Ride güzergahları (GPX/KML/KMZ) ----

export async function getStoredTracks(): Promise<MapTrack[]> {
  const result = await withDb(
    (db) =>
      new Promise<MapTrack[]>((resolve) => {
        try {
          const tx = db.transaction(TRACK_STORE, 'readonly')
          const req = tx.objectStore(TRACK_STORE).getAll()
          req.onsuccess = () => resolve((req.result as MapTrack[]) ?? [])
          req.onerror = () => resolve([])
        } catch {
          resolve([])
        }
      }),
  )
  return result ?? []
}

export async function putStoredTracks(tracks: MapTrack[]): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(TRACK_STORE, 'readwrite')
    const store = tx.objectStore(TRACK_STORE)
    store.clear()
    for (const track of tracks) store.put(track)
    await txDone(tx)
  })
}

export async function clearStoredTracks(): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(TRACK_STORE, 'readwrite')
    tx.objectStore(TRACK_STORE).clear()
    await txDone(tx)
  })
}
