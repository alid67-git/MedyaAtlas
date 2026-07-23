import goproTelemetry from 'gopro-telemetry'
import { fastGpmfExtract } from './fastGpmfExtract'

export interface GoProGps {
  latitude: number
  longitude: number
  takenAt?: Date
}

type GpsSample = {
  date?: Date | string
  value?: number[] | Record<string, number>
  sticky?: { fix?: number; precision?: number }
}

interface CoordSample {
  latitude: number
  longitude: number
  takenAt?: Date
  fix?: number
  precision?: number
}

interface GpsAnalysis {
  locked: GoProGps | null
  first: GoProGps | null
  hasFixInfo: boolean
  sawWarmup: boolean
  /** Telemetride hiç koordinat yok → dosyada GPS yok, hemen çık. */
  hasCoords: boolean
}

function isValidCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001)
  )
}

function readSampleCoords(sample: GpsSample): {
  latitude: number
  longitude: number
  takenAt?: Date
  fix?: number
} | null {
  let latitude: number | undefined
  let longitude: number | undefined
  let fix: number | undefined = sample.sticky?.fix

  if (Array.isArray(sample.value) && sample.value.length >= 2) {
    latitude = sample.value[0]
    longitude = sample.value[1]
    if (sample.value.length >= 9 && typeof sample.value[8] === 'number') {
      fix = sample.value[8]
    }
  } else if (sample.value && typeof sample.value === 'object') {
    const v = sample.value as Record<string, number>
    latitude = v.latitude ?? v.lat ?? v.Latitude
    longitude = v.longitude ?? v.lon ?? v.lng ?? v.Longitude
  }

  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !isValidCoord(latitude, longitude)
  ) {
    return null
  }

  const takenAt =
    sample.date instanceof Date
      ? sample.date
      : typeof sample.date === 'string'
        ? new Date(sample.date)
        : undefined

  return {
    latitude,
    longitude,
    fix,
    takenAt:
      takenAt && !Number.isNaN(takenAt.getTime()) ? takenAt : undefined,
  }
}

function extractCoordSamples(samples: GpsSample[]): CoordSample[] {
  const out: CoordSample[] = []
  let lastFix: number | undefined
  let lastPrecision: number | undefined
  for (const s of samples) {
    if (s.sticky?.fix != null) lastFix = s.sticky.fix
    if (s.sticky?.precision != null) lastPrecision = s.sticky.precision
    const c = readSampleCoords(s)
    if (!c) continue
    out.push({
      latitude: c.latitude,
      longitude: c.longitude,
      takenAt: c.takenAt,
      fix: c.fix ?? lastFix,
      precision: lastPrecision,
    })
  }
  return out
}

function toGps(s: CoordSample): GoProGps {
  return { latitude: s.latitude, longitude: s.longitude, takenAt: s.takenAt }
}

function analyzeTelemetry(telemetry: unknown): GpsAnalysis | null {
  if (!telemetry || typeof telemetry !== 'object') return null

  const all: CoordSample[] = []
  for (const device of Object.values(telemetry as Record<string, unknown>)) {
    if (!device || typeof device !== 'object') continue
    const streams = (
      device as { streams?: Record<string, { samples?: GpsSample[] }> }
    ).streams
    if (!streams) continue

    const seen = new Set<string>()
    for (const key of ['GPS9', 'GPS5', 'GPS', 'GLPI', 'GLPR'] as const) {
      const samples = streams[key]?.samples
      if (samples?.length) {
        all.push(...extractCoordSamples(samples))
        seen.add(key)
      }
    }
    for (const [key, stream] of Object.entries(streams)) {
      if (!seen.has(key) && stream?.samples?.length) {
        all.push(...extractCoordSamples(stream.samples))
      }
    }
  }

  if (!all.length) {
    return {
      locked: null,
      first: null,
      hasFixInfo: false,
      sawWarmup: false,
      hasCoords: false,
    }
  }

  const hasFixInfo = all.some((s) => s.fix != null)
  const sawWarmup = all.some((s) => s.fix != null && s.fix < 2)
  const lockedSample = all.find(
    (s) =>
      s.fix != null &&
      s.fix >= 2 &&
      (s.precision == null || s.precision <= 2000),
  )

  return {
    locked: lockedSample ? toGps(lockedSample) : null,
    first: toGps(all[0]),
    hasFixInfo,
    sawWarmup,
    hasCoords: true,
  }
}

async function analyzeExtracted(
  extracted: Awaited<ReturnType<typeof fastGpmfExtract>>,
  signal?: AbortSignal,
): Promise<GpsAnalysis | null> {
  try {
    const telemetry = await goproTelemetry(extracted, {
      stream: ['GPS5', 'GPS9'],
      tolerant: true,
    })
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return analyzeTelemetry(telemetry)
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    return null
  }
}

/**
 * GoPro GPMF GPS — hızlı ilk konum tespiti.
 */
export async function readGoProGps(
  file: File,
  signal?: AbortSignal,
): Promise<GoProGps | null> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  try {
    // Three samples are normally enough for a useful GoPro position while
    // avoiding tens of megabytes of telemetry reads per video.
    const probe = await fastGpmfExtract(file, signal, 3)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (!probe?.rawData) return null

    const first = await analyzeExtracted(probe, signal)
    if (!first || !first.hasCoords) return null
    if (first.locked) return first.locked
    // A coordinate is still more useful than dropping the video when a camera
    // writes no lock value or is at the beginning of its GPS warm-up period.
    return first.first
  } catch (e) {
    if (
      signal?.aborted ||
      (e instanceof DOMException && e.name === 'AbortError')
    ) {
      throw new DOMException('Aborted', 'AbortError')
    }
    return null
  }
}
