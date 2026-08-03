import type { MediaItem, MediaKind } from '../types'

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
  'insp',
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

export class ScanAbortedError extends Error {
  constructor() {
    super('Scan aborted')
    this.name = 'ScanAbortedError'
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new ScanAbortedError()
}

type FileWithPath = File & { webkitRelativePath?: string }

/**
 * Tarayıcı File listesini indeksler. GPS okunmaz — konum için yerel API
 * + Konum Bulucu (`baslat-v2.bat`, sürücü/klasör yolu) gerekir.
 */
export async function scanFiles(
  files: FileList | File[],
  sourceId: string,
  onProgress?: (
    done: number,
    total: number,
    located?: number,
    missing?: number,
  ) => void,
  signal?: AbortSignal,
  _useCache = true,
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
  const ignoredCount = list.length - mediaFiles.length
  const items: MediaItem[] = []
  const fileMap = new Map<string, File>()
  const skippedNames: string[] = []
  let done = 0
  const located = 0
  let missing = 0
  const cachedCount = 0

  let nextIndex = 0
  let lastProgressAt = 0
  const reportProgress = () => {
    const now = performance.now()
    if (done >= mediaFiles.length || now - lastProgressAt > 120) {
      lastProgressAt = now
      onProgress?.(done, mediaFiles.length, located, missing)
    }
  }

  while (nextIndex < mediaFiles.length) {
    throwIfAborted(signal)
    const file = mediaFiles[nextIndex]
    nextIndex += 1
    const kind = detectKind(file.name)!
    done += 1
    missing += 1
    skippedNames.push(file.name)

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
      latitude: 0,
      longitude: 0,
      locationMissing: true,
      takenAt: new Date(file.lastModified),
    })
    reportProgress()
    if (done % 48 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
  onProgress?.(done, mediaFiles.length, located, missing)

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
