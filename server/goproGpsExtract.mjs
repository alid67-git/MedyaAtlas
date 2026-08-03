/**
 * Disk üzerindeki GoPro MP4'ten GPMF GPS — moov + seyrek örnek okuma.
 * Yalnızca GPSF≥2 (2D/3D kilit) kabul; ısınma / son bilinen konum yok.
 * İlk geçerli kilitte çıkar. Tam dosya okumaz.
 */
import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const MP4Box = require('mp4box')

/** Orta/geç önce: GPS kilidi genelde ilk saniyelerde yok. */
const PROBE_FRACTIONS = [0.4, 0.6, 0.25, 0.8, 0.12, 0.92]
/** Sticky GPSF genelde birkaç örnekte bir gelir — 2 çok dardı. */
const SAMPLES_PER_PROBE = 8
const MOOV_CHUNK = 2 * 1024 * 1024
const MOOV_MAX_ITERS = 24
const HEAD_CHUNK = 256 * 1024

/** mp4box BoxParser Log.error → console.error spam (size=0 / type ' ') */
let boxParserSilenced = false
function silenceBoxParserLogs() {
  if (boxParserSilenced) return
  boxParserSilenced = true
  const orig = console.error.bind(console)
  console.error = (...args) => {
    for (const a of args) {
      if (
        typeof a === 'string' &&
        (a === '[BoxParser]' || a.includes('Unlimited box size'))
      ) {
        return
      }
    }
    orig(...args)
  }
}

/** GPS5/GPS9 lat-lon SCAL (GPMF divisor). */
export const GPS5_LATLON_SCALE = 10_000_000
const MIN_GPS_FIX = 2
const MAX_GPS_PRECISION = 2000
const GPS_STREAM_KEYS = ['GPS9', 'GPS5', 'GPS', 'GLPI', 'GLPR']

/**
 * Ham GPS5 tamsayılarını SCAL ile dereceye çevir.
 * [lat, lon, alt, speed2d, speed3d]
 */
export function applyGps5Scale(
  raw,
  scal = [GPS5_LATLON_SCALE, GPS5_LATLON_SCALE, 1000, 1000, 100],
) {
  return raw.map((v, i) => {
    const s = scal[i] ?? scal[scal.length - 1] ?? 1
    return typeof v === 'number' && s ? v / s : v
  })
}

export function isValidCoord(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001)
  )
}

export function isLockedFix(fix) {
  return fix != null && fix >= MIN_GPS_FIX
}

function sampleToPoint(sample) {
  const value = sample?.value
  let lat
  let lon
  let fix = sample?.sticky?.fix
  let precision = sample?.sticky?.precision
  if (Array.isArray(value) && value.length >= 2) {
    lat = value[0]
    lon = value[1]
    if (value.length >= 9 && typeof value[8] === 'number') fix = value[8]
    if (value.length >= 8 && typeof value[7] === 'number') precision = value[7]
  } else if (value && typeof value === 'object') {
    lat = value.latitude ?? value.lat ?? value.Latitude
    lon = value.longitude ?? value.lon ?? value.lng ?? value.Longitude
  }
  if (!isValidCoord(lat, lon)) return null
  const takenAt =
    sample.date instanceof Date
      ? sample.date
      : typeof sample.date === 'string'
        ? new Date(sample.date)
        : null
  return {
    latitude: lat,
    longitude: lon,
    fix,
    precision,
    takenAt: takenAt && !Number.isNaN(takenAt.getTime()) ? takenAt : null,
  }
}

function pickProbeIndices(count) {
  if (count <= 0) return []
  if (count === 1) return [0]
  const seen = new Set()
  const out = []
  for (const f of PROBE_FRACTIONS) {
    const i = Math.min(count - 1, Math.max(0, Math.floor(f * (count - 1))))
    if (seen.has(i)) continue
    seen.add(i)
    out.push(i)
  }
  return out
}

/**
 * Yalnızca moov + gpmd örnek tablosu (offset/size). Gövde okunmaz.
 * createFile(false) + nextParsePosition ile mdat atlanır (BoxParser spam yok).
 */
async function loadGpmdSampleTable(fh, fileSize) {
  silenceBoxParserLogs()
  return new Promise((resolve, reject) => {
    // keepMdatData=false → mdat gövdesi okunmaz / parse edilmez
    const mp4 = MP4Box.createFile(false)
    let settled = false

    const fail = (err) => {
      if (settled) return
      settled = true
      try {
        mp4.stop?.()
      } catch {
        /* */
      }
      reject(err instanceof Error ? err : new Error(String(err)))
    }

    const done = (result) => {
      if (settled) return
      settled = true
      try {
        mp4.stop?.()
      } catch {
        /* */
      }
      resolve(result)
    }

    mp4.onError = fail
    mp4.onReady = (meta) => {
      const telemetry = meta.tracks.find((t) => t.codec === 'gpmd')
      if (!telemetry) {
        fail(new Error('GoPro telemetry track not found'))
        return
      }
      const trak = mp4.getTrackById(telemetry.id)
      const raw = trak?.samples
      if (!raw?.length) {
        fail(new Error('GoPro telemetry samples empty'))
        return
      }
      const samples = raw.map((s) => ({
        offset: s.offset,
        size: s.size,
        cts: s.cts,
        duration: s.duration,
        timescale: s.timescale || telemetry.timescale || 1000,
      }))
      const video = meta.tracks.find((t) => t.type === 'video')
      let videoDuration = 0
      let frameDuration = 0
      if (video?.movie_duration && video.movie_timescale) {
        videoDuration = video.movie_duration / video.movie_timescale
        if (video.nb_samples) frameDuration = videoDuration / video.nb_samples
      }
      const start =
        telemetry.created instanceof Date ? telemetry.created : new Date()
      done({ samples, timing: { videoDuration, frameDuration, start } })
    }

    const watchdog = setTimeout(() => fail(new Error('GPMF moov timed out')), 12000)

    const readAt = async (offset, len) => {
      const buf = Buffer.alloc(len)
      await fh.read(buf, 0, len, offset)
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      ab.fileStart = offset
      return mp4.appendBuffer(ab)
    }

    ;(async () => {
      try {
        const visited = new Set()
        let iterations = 0

        if (fileSize <= MOOV_CHUNK) {
          await readAt(0, fileSize)
          if (!settled) mp4.flush()
          if (!settled) fail(new Error('GoPro moov not found'))
          return
        }

        // ftyp + mdat başlığı → nextParsePosition genelde moov'a zıplar
        let next = await readAt(0, Math.min(HEAD_CHUNK, fileSize))
        iterations += 1

        while (!settled && iterations < MOOV_MAX_ITERS) {
          const pos =
            typeof next === 'number' && next >= 0 ? next : fileSize
          if (pos >= fileSize) break
          if (visited.has(pos)) break
          visited.add(pos)
          const len = Math.min(MOOV_CHUNK, fileSize - pos)
          next = await readAt(pos, len)
          iterations += 1
        }
        if (!settled) mp4.flush()
        if (!settled) fail(new Error('GoPro moov not found'))
      } catch (e) {
        fail(e)
      } finally {
        clearTimeout(watchdog)
      }
    })()
  })
}

/** Ardışık/yakın örnekleri tek I/O'da oku. */
async function readSampleGroup(fh, samples, startIdx, count) {
  const group = []
  for (let i = 0; i < count && startIdx + i < samples.length; i += 1) {
    group.push(samples[startIdx + i])
  }
  if (!group.length) return null

  const first = group[0]
  const last = group[group.length - 1]
  const spanEnd = last.offset + last.size
  const contiguous = group.every((s, i) => {
    if (i === 0) return true
    const prev = group[i - 1]
    return s.offset === prev.offset + prev.size
  })

  if (contiguous && spanEnd - first.offset <= 512 * 1024) {
    const len = spanEnd - first.offset
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, first.offset)
    const rawData = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    return {
      rawData,
      timingSamples: group.map((s) => ({ cts: s.cts, duration: s.duration })),
    }
  }

  const parts = []
  let total = 0
  for (const s of group) {
    const buf = Buffer.alloc(s.size)
    await fh.read(buf, 0, s.size, s.offset)
    parts.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
    total += s.size
  }
  const rawData = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    rawData.set(p, off)
    off += p.length
  }
  return {
    rawData,
    timingSamples: group.map((s) => ({ cts: s.cts, duration: s.duration })),
  }
}

/** Yalnızca GPS akışları; kilit yoksa null. */
export function pointFromTelemetry(parsed) {
  const devices = parsed?.['1'] ? [parsed['1']] : Object.values(parsed || {})
  const points = []
  for (const device of devices) {
    const streams = device?.streams || {}
    for (const key of GPS_STREAM_KEYS) {
      const samples = streams[key]?.samples
      if (!Array.isArray(samples)) continue
      let lastFix
      let lastPrecision
      for (const sample of samples) {
        if (sample?.sticky?.fix != null) lastFix = sample.sticky.fix
        if (sample?.sticky?.precision != null) lastPrecision = sample.sticky.precision
        const p = sampleToPoint(sample)
        if (!p) continue
        if (p.fix == null) p.fix = lastFix
        if (p.precision == null) p.precision = lastPrecision
        points.push(p)
      }
    }
  }
  const locked = points.find(
    (p) =>
      isLockedFix(p.fix) &&
      (p.precision == null || p.precision <= MAX_GPS_PRECISION),
  )
  if (!locked) return null
  return {
    latitude: locked.latitude,
    longitude: locked.longitude,
    takenAt: locked.takenAt,
  }
}

/**
 * @returns {{
 *   status: 'found' | 'none' | 'error',
 *   latitude?: number,
 *   longitude?: number,
 *   takenAt?: Date | null,
 *   message?: string,
 * }}
 */
export async function readGoProGpsSeeking(path) {
  const [{ default: goproTelemetry }] = await Promise.all([import('gopro-telemetry')])
  let fh
  try {
    fh = await open(path, 'r')
  } catch (e) {
    return {
      status: 'error',
      message: e instanceof Error ? e.message : 'GoPro dosya açılamadı',
    }
  }
  try {
    const info = await fh.stat()
    let table
    try {
      table = await loadGpmdSampleTable(fh, info.size)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // gpmd yok = dosyada GPMF GPS yok (kesin)
      if (/telemetry track not found|telemetry samples empty/i.test(msg)) {
        return { status: 'none' }
      }
      return { status: 'error', message: msg }
    }
    const { samples, timing } = table
    const probes = pickProbeIndices(samples.length)
    let probeErrors = 0

    for (const idx of probes) {
      let extracted
      try {
        extracted = await readSampleGroup(fh, samples, idx, SAMPLES_PER_PROBE)
      } catch (e) {
        probeErrors += 1
        continue
      }
      if (!extracted?.rawData?.length) continue

      try {
        // GPSFix/GPSPrecision burada filtreleme — sticky GPSF sonda yoksa
        // kilitli örnekler de düşer. Kilit kontrolü pointFromTelemetry'de.
        const parsed = await goproTelemetry(
          {
            rawData: extracted.rawData,
            timing: {
              videoDuration: timing.videoDuration,
              frameDuration: timing.frameDuration,
              start: timing.start,
              samples: extracted.timingSamples,
            },
          },
          {
            stream: ['GPS5', 'GPS9'],
            tolerant: true,
          },
        )
        const point = pointFromTelemetry(parsed)
        if (point) {
          return {
            status: 'found',
            latitude: point.latitude,
            longitude: point.longitude,
            takenAt: point.takenAt,
          }
        }
      } catch {
        probeErrors += 1
      }
    }
    // Hiç sonda okunamadıysa ağ/IO — kesin "yok" sayma
    if (probes.length > 0 && probeErrors >= probes.length) {
      return { status: 'error', message: 'GPMF sondaları okunamadı' }
    }
    return { status: 'none' }
  } finally {
    await fh.close()
  }
}

export function goProLabel(path) {
  return basename(path)
}
