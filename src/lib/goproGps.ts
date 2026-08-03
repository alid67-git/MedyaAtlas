import goproTelemetry from 'gopro-telemetry'
import {
  loadGpmdSampleTable,
  readGpmdSampleBytes,
} from './fastGpmfExtract'

export interface GoProGps {
  latitude: number
  longitude: number
  takenAt?: Date
}

/** GPMF okunamadı (moov/IO) — kesin "GPS yok" sayılmamalı. */
export class GoProGpsExtractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoProGpsExtractError'
  }
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
  /** Telemetride hiç koordinat yok → dosyada GPS yok, hemen çık. */
  hasCoords: boolean
}

/** Orta/geç önce — GPS kilidi genelde ilk saniyelerde yok. */
const PROBE_FRACTIONS = [0.4, 0.6, 0.25, 0.8, 0.12, 0.92]
/** Sticky GPSF birkaç örnekte bir — 2 çok dardı. */
const SAMPLES_PER_PROBE = 8

/** GPS5/GPS9 lat-lon SCAL (GPMF: divisor, tipik 1e7). */
export const GPS5_LATLON_SCALE = 10_000_000

/** GPSF: 0=yok, 2=2D, 3=3D. Yalnızca kilitli örnekler. */
const MIN_GPS_FIX = 2
/** GPSP = DOP×100; 500 altı iyi, 2000 üstü çöp say. */
const MAX_GPS_PRECISION = 2000

const GPS_STREAM_KEYS = ['GPS9', 'GPS5', 'GPS', 'GLPI', 'GLPR'] as const

/**
 * Ham GPS5 tamsayılarını SCAL ile dereceye çevir (GPMF spec).
 * [lat, lon, alt, speed2d, speed3d]
 */
export function applyGps5Scale(
  raw: number[],
  scal: number[] = [
    GPS5_LATLON_SCALE,
    GPS5_LATLON_SCALE,
    1000,
    1000,
    100,
  ],
): number[] {
  return raw.map((v, i) => {
    const s = scal[i] ?? scal[scal.length - 1] ?? 1
    return typeof v === 'number' && s ? v / s : v
  })
}

export function isValidCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001)
  )
}

export function isLockedFix(fix: number | undefined | null): boolean {
  return fix != null && fix >= MIN_GPS_FIX
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
    // GPS9: fix per-sample at index 8
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

/** İlk kilitli + makul precision örneği; kilit yoksa null (ısınma/son bilinen konum yok). */
export function pickLockedGps(samples: CoordSample[]): GoProGps | null {
  const locked = samples.find(
    (s) =>
      isLockedFix(s.fix) &&
      (s.precision == null || s.precision <= MAX_GPS_PRECISION),
  )
  return locked ? toGps(locked) : null
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

    for (const key of GPS_STREAM_KEYS) {
      const samples = streams[key]?.samples
      if (samples?.length) all.push(...extractCoordSamples(samples))
    }
  }

  if (!all.length) {
    return { locked: null, hasCoords: false }
  }

  return {
    locked: pickLockedGps(all),
    hasCoords: true,
  }
}

function pickProbeIndices(count: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [0]
  const seen = new Set<number>()
  const out: number[] = []
  for (const f of PROBE_FRACTIONS) {
    const i = Math.min(count - 1, Math.max(0, Math.floor(f * (count - 1))))
    if (seen.has(i)) continue
    seen.add(i)
    out.push(i)
  }
  return out
}

/**
 * GoPro GPMF GPS — seyrek sonda + ilk kilitli konumda çık.
 * GPSF&lt;2 (kilit yok) veya yüksek DOP kabul edilmez — son bilinen
 * yanlış konum (ör. eski tatil) haritaya yazılmaz.
 * Altyapı hatasında GoProGpsExtractError fırlatır (önbelleğe "yok" yazma).
 */
export async function readGoProGps(
  file: File,
  signal?: AbortSignal,
): Promise<GoProGps | null> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  let table
  try {
    table = await loadGpmdSampleTable(file, signal)
  } catch (e) {
    if (
      signal?.aborted ||
      (e instanceof DOMException && e.name === 'AbortError')
    ) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const msg = e instanceof Error ? e.message : String(e)
    if (/telemetry track not found|telemetry samples empty/i.test(msg)) {
      return null
    }
    throw new GoProGpsExtractError(msg || 'GPMF moov okunamadı')
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const probes = pickProbeIndices(table.samples.length)
  let probeErrors = 0

  for (const idx of probes) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    let extracted
    try {
      extracted = await readGpmdSampleBytes(
        file,
        table.samples,
        idx,
        SAMPLES_PER_PROBE,
        signal,
      )
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      probeErrors += 1
      continue
    }
    if (!extracted?.rawData?.length) continue

    try {
      // GPSFix filtreleme yok — sticky GPSF sonda dışında kalırsa kilit düşmesin.
      const telemetry = await goproTelemetry(
        {
          rawData: extracted.rawData,
          timing: {
            videoDuration: table.timing.videoDuration,
            frameDuration: table.timing.frameDuration,
            start: table.timing.start,
            samples: extracted.timing.samples,
          },
        },
        {
          stream: ['GPS5', 'GPS9'],
          tolerant: true,
        },
      )
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

      const analysis = analyzeTelemetry(telemetry)
      if (!analysis?.hasCoords) continue
      if (analysis.locked) return analysis.locked
      // Kilit yok → sonraki sonda; asla kilitlenmemiş "first" kabul etme
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      probeErrors += 1
    }
  }

  if (probes.length > 0 && probeErrors >= probes.length) {
    throw new GoProGpsExtractError('GPMF sondaları okunamadı')
  }
  return null
}
