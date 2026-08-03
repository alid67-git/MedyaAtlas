/** GPX / KML / KMZ izleri — haritada çizgi olarak gösterilir. */

export interface TrackPoint {
  latitude: number
  longitude: number
  elevation?: number
  time?: number
}

export interface MapTrack {
  id: string
  name: string
  sourceId: string
  /** Harita çizimi için sadeleştirilmiş noktalar */
  points: TrackPoint[]
  /** Orijinal nokta sayısı (sadeleştirmeden önce) */
  pointCount?: number
  /** GPX zaman aralığı (ms), parse sırasında hesaplanır */
  timeStart?: number
  timeEnd?: number
  bounds?: { south: number; west: number; north: number; east: number }
  /** false ise menüden gizlenmiş */
  visible?: boolean
  addedAt?: number
}

/** Leaflet’i kilitlememek için üst sınır */
export const TRACK_DISPLAY_MAX_POINTS = 2500

function isFiniteCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  )
}

function newTrackId(): string {
  return `ride-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Liste/haritada gösterilecek ad = dosya adı (gömülü GPX/KML başlığı değil). */
export function trackFileDisplayName(fileName: string): string {
  const base = fileName.replace(/^.*[/\\]/, '').trim()
  return base || fileName
}

/** Eşit aralıklı örnekleme — büyük GPX’lerde UI donmasını önler. */
export function simplifyTrackPoints(
  points: TrackPoint[],
  maxPoints = TRACK_DISPLAY_MAX_POINTS,
): TrackPoint[] {
  if (points.length <= maxPoints) return points
  const step = Math.ceil(points.length / maxPoints)
  const out: TrackPoint[] = []
  for (let i = 0; i < points.length; i += step) out.push(points[i])
  const last = points[points.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

/** Parse / IDB yüklemesi sonrası: tarih, bounds, sade noktalar. */
export function finalizeTrack(
  track: MapTrack,
  maxPoints = TRACK_DISPLAY_MAX_POINTS,
): MapTrack {
  const raw = track.points
  if (raw.length === 0) return track

  let timeStart = track.timeStart
  let timeEnd = track.timeEnd
  let south = track.bounds?.south ?? 90
  let north = track.bounds?.north ?? -90
  let west = track.bounds?.west ?? 180
  let east = track.bounds?.east ?? -180
  const needMeta =
    timeStart == null ||
    timeEnd == null ||
    !track.bounds ||
    track.pointCount == null ||
    raw.length > maxPoints

  if (needMeta) {
    timeStart = undefined
    timeEnd = undefined
    south = 90
    north = -90
    west = 180
    east = -180
    for (const p of raw) {
      if (typeof p.time === 'number' && Number.isFinite(p.time)) {
        timeStart = timeStart == null ? p.time : Math.min(timeStart, p.time)
        timeEnd = timeEnd == null ? p.time : Math.max(timeEnd, p.time)
      }
      south = Math.min(south, p.latitude)
      north = Math.max(north, p.latitude)
      west = Math.min(west, p.longitude)
      east = Math.max(east, p.longitude)
    }
  }

  const pointCount = track.pointCount ?? raw.length
  const points = simplifyTrackPoints(raw, maxPoints)

  return {
    ...track,
    points,
    pointCount,
    timeStart,
    timeEnd,
    bounds: { south, west, north, east },
  }
}

function parseGpx(text: string, name: string, sourceId: string): MapTrack | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) return null
  const points: TrackPoint[] = []
  const nodes = doc.querySelectorAll('trkpt, rtept')
  nodes.forEach((node) => {
    const lat = Number(node.getAttribute('lat'))
    const lon = Number(node.getAttribute('lon'))
    if (!isFiniteCoord(lat, lon)) return
    const ele = node.querySelector('ele')
    const time = node.querySelector('time')
    points.push({
      latitude: lat,
      longitude: lon,
      elevation: ele ? Number(ele.textContent) : undefined,
      time: time?.textContent ? Date.parse(time.textContent) : undefined,
    })
  })
  if (points.length < 2) return null
  return finalizeTrack({
    id: newTrackId(),
    name: trackFileDisplayName(name),
    sourceId,
    points,
    visible: true,
    addedAt: Date.now(),
  })
}

function parseKmlCoords(text: string): TrackPoint[] {
  const points: TrackPoint[] = []
  const re = /<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const chunk = match[1]
    for (const token of chunk.trim().split(/\s+/)) {
      const parts = token.split(',')
      if (parts.length < 2) continue
      const lon = Number(parts[0])
      const lat = Number(parts[1])
      const elevation = parts[2] != null ? Number(parts[2]) : undefined
      if (!isFiniteCoord(lat, lon)) continue
      points.push({ latitude: lat, longitude: lon, elevation })
    }
  }
  return points
}

function parseKml(text: string, name: string, sourceId: string): MapTrack | null {
  const points = parseKmlCoords(text)
  if (points.length < 2) return null
  return finalizeTrack({
    id: newTrackId(),
    name: trackFileDisplayName(name),
    sourceId,
    points,
    visible: true,
    addedAt: Date.now(),
  })
}

async function unzipKmzToKml(file: File): Promise<string | null> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let offset = 0
  while (offset + 30 < bytes.length) {
    if (
      bytes[offset] !== 0x50 ||
      bytes[offset + 1] !== 0x4b ||
      bytes[offset + 2] !== 0x03 ||
      bytes[offset + 3] !== 0x04
    ) {
      break
    }
    const compression = bytes[offset + 8] | (bytes[offset + 9] << 8)
    const compSize =
      bytes[offset + 18] |
      (bytes[offset + 19] << 8) |
      (bytes[offset + 20] << 16) |
      (bytes[offset + 21] << 24)
    const nameLen = bytes[offset + 26] | (bytes[offset + 27] << 8)
    const extraLen = bytes[offset + 28] | (bytes[offset + 29] << 8)
    const nameStart = offset + 30
    const fileName = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen))
    const dataStart = nameStart + nameLen + extraLen
    const data = bytes.subarray(dataStart, dataStart + compSize)
    offset = dataStart + compSize
    if (!/\.kml$/i.test(fileName)) continue
    if (compression === 0) {
      return new TextDecoder().decode(data)
    }
    if (compression === 8 && typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate-raw')
      const stream = new Blob([data]).stream().pipeThrough(ds)
      const out = await new Response(stream).arrayBuffer()
      return new TextDecoder().decode(out)
    }
  }
  return null
}

export function isTrackFileName(name: string): boolean {
  return /\.(gpx|kml|kmz)$/i.test(name)
}

export async function parseTrackFile(
  file: File,
  sourceId: string,
): Promise<MapTrack | null> {
  const lower = file.name.toLowerCase()
  try {
    if (lower.endsWith('.gpx')) {
      return parseGpx(await file.text(), file.name, sourceId)
    }
    if (lower.endsWith('.kml')) {
      return parseKml(await file.text(), file.name, sourceId)
    }
    if (lower.endsWith('.kmz')) {
      const kml = await unzipKmzToKml(file)
      if (!kml) return null
      return parseKml(kml, file.name, sourceId)
    }
  } catch {
    return null
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

/** Noktanın güzergaha (kırık çizgiye) en kısa mesafesi (metre). */
export function distanceToTrackMeters(
  lat: number,
  lon: number,
  track: MapTrack,
): number {
  const pts = track.points
  if (pts.length === 0) return Infinity
  if (pts.length === 1) {
    return haversineMeters(lat, lon, pts[0].latitude, pts[0].longitude)
  }
  let best = Infinity
  const step = pts.length > 800 ? Math.ceil(pts.length / 400) : 1
  for (let i = 0; i < pts.length - 1; i += step) {
    const a = pts[i]
    const b = pts[Math.min(i + step, pts.length - 1)]
    const d1 = haversineMeters(lat, lon, a.latitude, a.longitude)
    const d2 = haversineMeters(lat, lon, b.latitude, b.longitude)
    const midLat = (a.latitude + b.latitude) / 2
    const midLon = (a.longitude + b.longitude) / 2
    const dMid = haversineMeters(lat, lon, midLat, midLon)
    best = Math.min(best, d1, d2, dMid)
  }
  return best
}

/** Güzergah koridorundaki medya (varsayılan 300 m). */
export function itemsNearTrack<
  T extends { latitude: number; longitude: number; locationMissing?: boolean },
>(items: T[], track: MapTrack, maxMeters = 300): T[] {
  return items.filter((item) => {
    if (item.locationMissing) return false
    return distanceToTrackMeters(item.latitude, item.longitude, track) <= maxMeters
  })
}

/** Ride noktalarındaki zamanlardan takvim günü aralığı (yerel gün başı/sonu). */
export function trackDateRange(track: MapTrack): {
  start: number
  end: number
} | null {
  let min = track.timeStart
  let max = track.timeEnd
  if (min == null || max == null) {
    const times: number[] = []
    for (const p of track.points) {
      if (typeof p.time === 'number' && Number.isFinite(p.time)) times.push(p.time)
    }
    if (times.length === 0) return null
    min = Math.min(...times)
    max = Math.max(...times)
  }
  const start = new Date(min)
  start.setHours(0, 0, 0, 0)
  const end = new Date(max)
  end.setHours(23, 59, 59, 999)
  return { start: start.getTime(), end: end.getTime() }
}

/** Ride’ın tarih aralığında çekilmiş medya (GPS’li + takenAt). */
export function itemsOnTrackDates<
  T extends { takenAt?: Date; locationMissing?: boolean },
>(items: T[], track: MapTrack): T[] {
  const range = trackDateRange(track)
  if (!range) return []
  return items.filter((item) => {
    if (item.locationMissing) return false
    if (!item.takenAt) return false
    const t = item.takenAt.getTime()
    return t >= range.start && t <= range.end
  })
}

export function formatTrackDateRange(track: MapTrack): string | null {
  const range = trackDateRange(track)
  if (!range) return null
  const fmt = (ms: number) =>
    new Date(ms).toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  const a = fmt(range.start)
  const b = fmt(range.end)
  return a === b ? a : `${a} – ${b}`
}

export function trackBounds(track: MapTrack): {
  south: number
  west: number
  north: number
  east: number
} | null {
  if (track.bounds) return track.bounds
  if (track.points.length === 0) return null
  let south = 90
  let north = -90
  let west = 180
  let east = -180
  for (const p of track.points) {
    south = Math.min(south, p.latitude)
    north = Math.max(north, p.latitude)
    west = Math.min(west, p.longitude)
    east = Math.max(east, p.longitude)
  }
  return { south, west, north, east }
}
