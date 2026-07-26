import exifr from 'exifr'
import ExifReader from 'exifreader'
import type { MediaItem, MediaKind } from '../types'
import { readGoProGps } from './goproGps'
import { fileSignature, getGpsCacheSnapshot, putCachedGps } from './cache'

const PHOTO_EXT = new Set([
  'jpg',
  'jpeg',
  'jpe',
  'png',
  'webp',
  'heic',
  'heif',
  'tif',
  'tiff',
  'dng',
  'gpr',
  'arw',
  'cr2',
  'cr3',
  'nef',
  'nrw',
  'orf',
  'raf',
  'rw2',
  'pef',
  'srw',
  'x3f',
  'avif',
  'gif',
  'bmp',
])

// LRV: GoPro'nun düşük çözünürlüklü kopyaları — değerlendirmeye alınmaz
const VIDEO_EXT = new Set([
  'mp4',
  'mov',
  'm4v',
  'avi',
  'mkv',
  'webm',
  '360',
  'insv',
  'ts',
  'mts',
  'm2ts',
  '3gp',
  '3g2',
  'wmv',
  'mpg',
  'mpeg',
])

// GH010123, GX010123, GOPR1234, GP010123, GO012345 vb.
// GSxxxxxx, GoPro Max 360'ın çift lensli .360 dosya adıdır.
const GOPRO_NAME = /^(gopr|g[xhs]\d{6}|gpfr|gp\d{6}|go\d{6})/i
const DJI_VIDEO_NAME = /^DJI[_-]/i

export function getExtension(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function detectKind(name: string): MediaKind | null {
  const ext = getExtension(name)
  if (PHOTO_EXT.has(ext)) return 'photo'
  if (VIDEO_EXT.has(ext)) {
    if (DJI_VIDEO_NAME.test(name.replace(/\.[^.]+$/, ''))) return 'drone'
    return GOPRO_NAME.test(name.replace(/\.[^.]+$/, '')) ? 'gopro' : 'video'
  }
  return null
}

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function groupByLocation(
  items: MediaItem[],
  radiusMeters = 80,
): { id: string; latitude: number; longitude: number; items: MediaItem[] }[] {
  const clusters: {
    id: string
    latitude: number
    longitude: number
    items: MediaItem[]
  }[] = []

  for (const item of items) {
    let nearest = -1
    let nearestDist = Infinity

    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i]
      const d = haversineMeters(
        item.latitude,
        item.longitude,
        c.latitude,
        c.longitude,
      )
      if (d < nearestDist) {
        nearestDist = d
        nearest = i
      }
    }

    if (nearest >= 0 && nearestDist <= radiusMeters) {
      const c = clusters[nearest]
      c.items.push(item)
      const n = c.items.length
      c.latitude = c.items.reduce((s, x) => s + x.latitude, 0) / n
      c.longitude = c.items.reduce((s, x) => s + x.longitude, 0) / n
    } else {
      clusters.push({
        id: `loc-${clusters.length}-${item.id}`,
        latitude: item.latitude,
        longitude: item.longitude,
        items: [item],
      })
    }
  }

  return clusters
}

type GpsResult = {
  latitude: number
  longitude: number
  takenAt?: Date
  width?: number
  height?: number
  fromGoPro?: boolean
}

function isValidGps(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    // Bazı kameralar GPS kilidi yokken sıfıra çok yakın varsayılan bir
    // koordinat yazar. Bu, haritada Gine Körfezi'ndeki "Null Island"dır.
    !(Math.abs(lat) < 0.01 && Math.abs(lon) < 0.01)
  )
}

function asGpsPair(
  lat: unknown,
  lon: unknown,
): { latitude: number; longitude: number } | null {
  if (!isValidGps(lat, lon)) return null
  return { latitude: lat, longitude: lon as number }
}

async function readGpsWithExifr(file: File): Promise<GpsResult | null> {
  try {
    // Yalnızca GPS — yoksa hemen çık (ikinci tam parse saatler kaybettirir).
    const gpsOnly = await exifr.gps(file)
    if (!gpsOnly || !isValidGps(gpsOnly.latitude, gpsOnly.longitude)) {
      return null
    }

    let takenAt: Date | undefined
    let width: number | undefined
    let height: number | undefined
    try {
      const meta = await exifr.parse(file, {
        pick: [
          'DateTimeOriginal',
          'CreateDate',
          'ImageWidth',
          'ImageHeight',
          'ExifImageWidth',
          'ExifImageHeight',
        ],
      })
      takenAt =
        meta?.DateTimeOriginal instanceof Date
          ? meta.DateTimeOriginal
          : meta?.CreateDate instanceof Date
            ? meta.CreateDate
            : undefined
      width = meta?.ExifImageWidth ?? meta?.ImageWidth
      height = meta?.ExifImageHeight ?? meta?.ImageHeight
    } catch {
      // GPS yeterli
    }
    return {
      latitude: gpsOnly.latitude,
      longitude: gpsOnly.longitude,
      takenAt,
      width,
      height,
    }
  } catch {
    return null
  }
}

function dmsToDecimal(
  dms: number[] | undefined,
  ref: string | undefined,
): number | null {
  if (!dms || dms.length < 3) return null
  const [d, m, s] = dms
  if (![d, m, s].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null
  }
  let dec = Math.abs(d) + m / 60 + s / 3600
  if (ref === 'S' || ref === 'W') dec = -dec
  return dec
}

async function readGpsWithExifReader(file: File): Promise<GpsResult | null> {
  try {
    const tags = await ExifReader.load(file, {
      expanded: true,
      async: true,
    })

    let latitude: number | undefined = tags.gps?.Latitude
    let longitude: number | undefined = tags.gps?.Longitude

    if (!isValidGps(latitude, longitude)) {
      const flat = tags as Record<
        string,
        { description?: string; value?: unknown } | undefined
      >
      latitude =
        dmsToDecimal(
          flat.GPSLatitude?.value as number[] | undefined,
          String(flat.GPSLatitudeRef?.value ?? flat.GPSLatitudeRef?.description ?? ''),
        ) ?? undefined
      longitude =
        dmsToDecimal(
          flat.GPSLongitude?.value as number[] | undefined,
          String(
            flat.GPSLongitudeRef?.value ?? flat.GPSLongitudeRef?.description ?? '',
          ),
        ) ?? undefined
    }

    const pair = asGpsPair(latitude, longitude)
    if (!pair) return null

    const dateDesc =
      tags.exif?.DateTimeOriginal?.description ??
      (tags as { DateTimeOriginal?: { description?: string } }).DateTimeOriginal
        ?.description

    let takenAt: Date | undefined
    if (dateDesc) {
      const normalized = dateDesc.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
      const d = new Date(normalized)
      if (!Number.isNaN(d.getTime())) takenAt = d
    }

    const fileTags = tags.file as
      | Record<string, { value?: number } | undefined>
      | undefined

    return {
      ...pair,
      takenAt,
      width: fileTags?.['Image Width']?.value,
      height: fileTags?.['Image Height']?.value,
    }
  } catch {
    return null
  }
}

async function readExifGps(file: File): Promise<GpsResult | null> {
  const fromExifr = await readGpsWithExifr(file)
  if (fromExifr) return fromExifr

  // ExifReader yalnızca HEIC'te: JPG'de GPS yoksa ikinci ağır okuma yapma.
  const ext = getExtension(file.name)
  if (
    ext === 'heic' ||
    ext === 'heif' ||
    file.type.includes('heic') ||
    file.type.includes('heif')
  ) {
    return readGpsWithExifReader(file)
  }

  return readGpsWithExifReader(file)
}

/**
 * Telefon videolarında nadir ©xyz / ISO 6709 atomu — sadece dosya başı.
 * Tüm videoyu EXIF ile okumak GB'lerce dosyada saatler sürer.
 */
async function readVideoMp4GpsLight(
  file: File,
  signal?: AbortSignal,
): Promise<GpsResult | null> {
  throwIfAborted(signal)
  const segmentSize = 256 * 1024
  const headEnd = Math.min(segmentSize, file.size)
  const decoder = new TextDecoder('latin1')
  try {
    const head = decoder.decode(await file.slice(0, headEnd).arrayBuffer())
    const fromHead = coordinatesFromText(head)
    if (fromHead || headEnd >= file.size) return fromHead

    throwIfAborted(signal)
    const tailStart = Math.max(headEnd, file.size - segmentSize)
    const tail = decoder.decode(await file.slice(tailStart).arrayBuffer())
    return coordinatesFromText(`${head}\0${tail}`)
  } catch {
    return null
  }
}

function coordinatesFromText(text: string): GpsResult | null {
  const labeled =
    /(?:latitude|lat)\s*[:=]\s*([+-]?\d{1,2}(?:\.\d+)?)[\s\S]{0,160}?(?:longitude|long|lon)\s*[:=]\s*([+-]?\d{1,3}(?:\.\d+)?)/i.exec(
      text,
    )
  if (labeled) {
    const pair = asGpsPair(Number(labeled[1]), Number(labeled[2]))
    if (pair) return pair
  }

  // ISO 6709: +41.123456+029.123456/ (bazı MP4 location atomları)
  const iso =
    /([+-]\d{1,2}\.\d{4,})([+-]\d{1,3}\.\d{4,})(?:[+-]\d+(?:\.\d+)?)?\//.exec(
      text,
    )
  if (iso) {
    const pair = asGpsPair(Number(iso[1]), Number(iso[2]))
    if (pair) return pair
  }
  return null
}

async function readDjiSrtGps(file: File): Promise<GpsResult | null> {
  try {
    return coordinatesFromText(await file.text())
  } catch {
    return null
  }
}

/**
 * SRT'si kaybolmuş DJI MP4'lerde son şans: MP4 başındaki metadata.
 * 8MB×2 okumak yavaştı; 1MB başı çoğu atom için yeter.
 */
async function readDjiMp4Gps(
  file: File,
  signal?: AbortSignal,
): Promise<GpsResult | null> {
  return readVideoMp4GpsLight(file, signal)
}

export class ScanAbortedError extends Error {
  constructor() {
    super('Scan aborted')
    this.name = 'ScanAbortedError'
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new ScanAbortedError()
}

async function readGps(
  file: File,
  kind: MediaKind,
  signal?: AbortSignal,
): Promise<{
  latitude: number
  longitude: number
  takenAt?: Date
  width?: number
  height?: number
  fromGoPro?: boolean
} | null> {
  throwIfAborted(signal)

  // Türüne göre kısa yol — videoya EXIF uygulamak asıl yavaşlık kaynağıydı.
  if (kind === 'photo') {
    return readExifGps(file)
  }

  if (kind === 'drone') {
    return readDjiMp4Gps(file, signal)
  }

  if (kind === 'gopro') {
    try {
      const gopro = await readGoProGps(file, signal)
      throwIfAborted(signal)
      if (gopro) {
        return {
          latitude: gopro.latitude,
          longitude: gopro.longitude,
          takenAt: gopro.takenAt,
          fromGoPro: true,
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw new ScanAbortedError()
      }
      throw e
    }
    return null
  }

  // Telefon videosu: yalnızca baştaki konum atomu (GPMF yok)
  if (kind === 'video') {
    return readVideoMp4GpsLight(file, signal)
  }

  return null
}

type FileWithPath = File & { webkitRelativePath?: string }

/** Tüm taramalar boyunca ortak slot. Artık çoğu dosya milisaniyede eleniyor. */
// Mechanical external drives become much slower when too many videos are read
// concurrently. Three slots preserve throughput without excessive seeking.
const MAX_SCAN_SLOTS = 4
let scanSlotsInUse = 0
const scanSlotWaiters: Array<() => void> = []

async function acquireScanSlot(signal?: AbortSignal): Promise<void> {
  if (scanSlotsInUse < MAX_SCAN_SLOTS) {
    scanSlotsInUse += 1
    return
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      const idx = scanSlotWaiters.indexOf(tryAcquire)
      if (idx >= 0) scanSlotWaiters.splice(idx, 1)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const tryAcquire = () => {
      if (signal?.aborted) {
        onAbort()
        return
      }
      if (scanSlotsInUse < MAX_SCAN_SLOTS) {
        scanSlotsInUse += 1
        signal?.removeEventListener('abort', onAbort)
        resolve()
        return
      }
      scanSlotWaiters.push(tryAcquire)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    scanSlotWaiters.push(tryAcquire)
  })
}

function releaseScanSlot(): void {
  scanSlotsInUse = Math.max(0, scanSlotsInUse - 1)
  const next = scanSlotWaiters.shift()
  if (next) next()
}

export async function scanFiles(
  files: FileList | File[],
  sourceId: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  useCache = true,
  acceptedKinds: ReadonlySet<MediaKind> = new Set<MediaKind>([
    'photo',
    'video',
    'gopro',
    'drone',
  ]),
): Promise<{
  items: MediaItem[]
  files: Map<string, File>
  skipped: number
  skippedNames: string[]
  mediaCount: number
  ignoredCount: number
  cachedCount: number
}> {
  const list = Array.from(files)
  const mediaFiles = list.filter((f) => {
    const kind = detectKind(f.name)
    return kind !== null && acceptedKinds.has(kind)
  })
  // Yenilemede binlerce tekil IndexedDB sorgusu yerine, paylaÅŸÄ±lan
  // Ã¶nbellek anlık gÃ¶rÃ¼ntÃ¼sÃ¼ tek iÅŸlemde alÄ±nÄ±r.
  const gpsCache = useCache ? await getGpsCacheSnapshot() : null
  const ignoredCount = list.length - mediaFiles.length
  const items: MediaItem[] = []
  const fileMap = new Map<string, File>()
  const skippedNames: string[] = []
  let done = 0
  let cachedCount = 0

  // Aynı klasördeki .xmp yan dosyalarını eşle
  const sidecars = new Map<string, File>()
  for (const f of list) {
    const ext = getExtension(f.name)
    if (ext === 'xmp' || ext === 'srt') {
      const base = f.name.replace(/\.[^.]+$/, '').toLowerCase()
      sidecars.set(`${base}.${ext}`, f)
    }
  }

  const processFile = async (file: File): Promise<void> => {
    let kind = detectKind(file.name)!
    const sig = fileSignature(file)
    const base = file.name.replace(/\.[^.]+$/, '').toLowerCase()
    const djiSrt =
      kind === 'drone' ? sidecars.get(`${base}.srt`) : undefined

    // 1) Önce hafızaya (indeks) bak
    const cached = gpsCache?.get(sig) ?? null

    // Sonradan SRT eklenmişse eski "GPS yok" kaydını kullanma.
    if (cached && !(!cached.hasGps && djiSrt)) {
      cachedCount += 1
      done += 1

      if (!cached.hasGps) {
        skippedNames.push(file.name)
        return
      }

      const relativePath = (file as FileWithPath).webkitRelativePath || file.name
      const id = `${sourceId}|${relativePath}|${file.size}|${file.lastModified}`
      fileMap.set(id, file)
      items.push({
        id,
        name: file.name,
        relativePath,
        sourceId,
        kind: cached.kind ?? kind,
        available: true,
        latitude: cached.latitude!,
        longitude: cached.longitude!,
        // Metadata'da tarih yoksa dosyanın değiştirilme tarihine düş
        takenAt: cached.takenAt
          ? new Date(cached.takenAt)
          : new Date(file.lastModified),
        width: cached.width,
        height: cached.height,
      })
      return
    }

    // 2) Hafızada yoksa çöz (küresel slot: paralel kaynak taramaları paylaşır)
    await acquireScanSlot(signal)
    let gps
    try {
      gps = djiSrt
        ? await readDjiSrtGps(djiSrt)
        : await readGps(file, kind, signal)

      if (!gps) {
        const xmp = sidecars.get(`${base}.xmp`)
        if (xmp) {
          gps = await readExifGps(xmp)
        }
      }
    } finally {
      releaseScanSlot()
    }

    done += 1

    if (!gps) {
      skippedNames.push(file.name)
      if (useCache) {
        await putCachedGps({ sig, hasGps: false })
      }
      return
    }

    if (gps.fromGoPro) kind = 'gopro'

    // Metadata'da tarih yoksa dosyanın değiştirilme tarihine düş
    const takenAt = gps.takenAt ?? new Date(file.lastModified)

    if (useCache) {
      await putCachedGps({
        sig,
        hasGps: true,
        latitude: gps.latitude,
        longitude: gps.longitude,
        takenAt: takenAt.getTime(),
        kind,
        width: gps.width,
        height: gps.height,
      })
    }

    const relativePath = (file as FileWithPath).webkitRelativePath || file.name
    const id = `${sourceId}|${relativePath}|${file.size}|${file.lastModified}`
    fileMap.set(id, file)

    items.push({
      id,
      name: file.name,
      relativePath,
      sourceId,
      kind,
      available: true,
      latitude: gps.latitude,
      longitude: gps.longitude,
      takenAt,
      width: gps.width,
      height: gps.height,
    })
  }

  // İşçi sayısı küresel slotla sınırlı; fazlası bekler. Disk thrash azalır.
  const CONCURRENCY = MAX_SCAN_SLOTS
  let nextIndex = 0
  let lastProgressAt = 0
  const reportProgress = () => {
    const now = performance.now()
    if (done >= mediaFiles.length || now - lastProgressAt > 120) {
      lastProgressAt = now
      onProgress?.(done, mediaFiles.length)
    }
  }
  const worker = async (): Promise<void> => {
    let sinceLastYield = 0
    while (nextIndex < mediaFiles.length) {
      throwIfAborted(signal)
      const file = mediaFiles[nextIndex]
      nextIndex += 1
      await processFile(file)
      reportProgress()

      // Ã–nbellekteki dosyalar Ã§ok hÄ±zlÄ± dÃ¶ndÃ¼ÄŸÃ¼nde binlerce mikro-gÃ¶rev
      // Chrome'un arayÃ¼zÃ¼ Ã§izmesini engelleyebiliyordu. KÄ±sa bir mola,
      // haritayÄ± ve Ä°ptal dÃ¼ÄŸmesini canlÄ± tutar.
      sinceLastYield += 1
      if (sinceLastYield >= 48) {
        sinceLastYield = 0
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, mediaFiles.length) }, worker),
  )
  onProgress?.(done, mediaFiles.length)

  return {
    items,
    files: fileMap,
    skipped: skippedNames.length,
    skippedNames,
    mediaCount: mediaFiles.length,
    ignoredCount,
    cachedCount,
  }
}

export function revokeMediaUrls(items: MediaItem[]) {
  for (const item of items) {
    if (item.url) URL.revokeObjectURL(item.url)
  }
}

export const KIND_LABEL: Record<MediaKind, string> = {
  photo: 'Fotoğraf',
  video: 'Video',
  gopro: 'GoPro',
  drone: 'Drone',
}
