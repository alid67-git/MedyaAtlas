/**
 * Hızlı konum kademesi — "video daki konum neresi" location_extractor mantığı.
 * mutagen/ffprobe önce; ExifTool yalnızca hızlı yol okuyamazsa.
 * GoPro GPMF / DJI djmd bu modülde yok — çağıran taraf karar verir.
 */
import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

const ISO6709_RE =
  /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:([+-]\d+(?:\.\d+)?))?\/?$/

/** @type {string | null | undefined} */
let cachedFfprobe
/** @type {string | null | undefined} */
let cachedExiftool

let toolActive = 0
const toolWait = []
const TOOL_MAX = 4

async function acquireTool() {
  if (toolActive >= TOOL_MAX) {
    await new Promise((resolve) => toolWait.push(resolve))
  }
  toolActive += 1
}

function releaseTool() {
  toolActive = Math.max(0, toolActive - 1)
  toolWait.shift()?.()
}

function gps(lat, lon) {
  lat = Number(lat)
  lon = Number(lon)
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return null
  }
  if (Math.abs(lat) < 0.01 && Math.abs(lon) < 0.01) return null
  return { latitude: lat, longitude: lon }
}

function parseIso6709(value) {
  if (typeof value !== 'string') return null
  const match = ISO6709_RE.exec(value.trim())
  if (!match) return null
  return gps(match[1], match[2])
}

function scanTagsForIso6709(tags) {
  if (!tags || typeof tags !== 'object') return null
  for (const [key, value] of Object.entries(tags)) {
    const keyL = String(key).toLowerCase()
    if (
      !keyL.includes('iso6709') &&
      !keyL.includes('location') &&
      !keyL.includes('xyz') &&
      !keyL.includes('gps')
    ) {
      continue
    }
    if (typeof value === 'string') {
      const parsed = parseIso6709(value.replace(/\s+/g, ''))
      if (parsed) return parsed
      const parts = value.match(/[+-]?\d+(?:\.\d+)?/g)
      if (parts && parts.length >= 2) {
        const point = gps(parts[0], parts[1])
        if (point) return point
      }
    }
    if (Array.isArray(value) && value.length >= 2) {
      const point = gps(value[0], value[1])
      if (point) return point
    }
  }
  return null
}

function looksLikeCoordPair(tags) {
  if (!tags || typeof tags !== 'object') return null
  const lower = Object.fromEntries(
    Object.entries(tags).map(([k, v]) => [String(k).toLowerCase(), v]),
  )
  const latKeys = [
    'location-lat',
    'location_latitude',
    'com.apple.quicktime.location.latitude',
    'latitude',
    'gpslatitude',
    'lat',
  ]
  const lonKeys = [
    'location-lon',
    'location_longitude',
    'com.apple.quicktime.location.longitude',
    'longitude',
    'gpslongitude',
    'lon',
    'lng',
  ]
  let lat
  let lon
  for (const key of latKeys) {
    if (lower[key] == null || lower[key] === '') continue
    const n = Number(String(lower[key]).replace(',', '.'))
    if (Number.isFinite(n)) {
      lat = n
      break
    }
  }
  for (const key of lonKeys) {
    if (lower[key] == null || lower[key] === '') continue
    const n = Number(String(lower[key]).replace(',', '.'))
    if (Number.isFinite(n)) {
      lon = n
      break
    }
  }
  return gps(lat, lon)
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function which(cmd) {
  const isWin = process.platform === 'win32'
  try {
    const { stdout } = await execFileAsync(
      isWin ? 'where.exe' : 'which',
      [cmd],
      { windowsHide: true, encoding: 'utf8' },
    )
    const first = String(stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean)
    return first || null
  } catch {
    return null
  }
}

async function resolveFfprobe() {
  if (cachedFfprobe !== undefined) return cachedFfprobe
  cachedFfprobe =
    (await which('ffprobe')) ||
    (await which('ffprobe.exe')) ||
    null
  return cachedFfprobe
}

async function resolveExiftool() {
  if (cachedExiftool !== undefined) return cachedExiftool
  const fromPath =
    (await which('exiftool')) || (await which('exiftool.exe'))
  if (fromPath) {
    cachedExiftool = fromPath
    return cachedExiftool
  }
  const candidates = []
  try {
    const pkg = require.resolve('exiftool-vendored.exe/package.json')
    candidates.push(join(dirname(pkg), 'bin', 'exiftool.exe'))
    candidates.push(join(dirname(pkg), 'bin', 'exiftool'))
  } catch {
    /* paket yok */
  }
  candidates.push(
    join(here, '..', 'node_modules', 'exiftool-vendored.exe', 'bin', 'exiftool.exe'),
  )
  for (const cand of candidates) {
    if (await pathExists(cand)) {
      cachedExiftool = cand
      return cachedExiftool
    }
  }
  cachedExiftool = null
  return null
}

/**
 * @returns {Promise<{ point: {latitude:number,longitude:number}|null, cleanMiss: boolean, source: string } | null>}
 * null = araç yok / çalıştırılamadı
 */
export async function extractWithFfprobe(path) {
  const exe = await resolveFfprobe()
  if (!exe) return null
  await acquireTool()
  try {
    const { stdout } = await execFileAsync(
      exe,
      [
        '-v',
        'quiet',
        '-probesize',
        '65536',
        '-analyzeduration',
        '0',
        '-print_format',
        'json',
        '-show_entries',
        'format_tags',
        path,
      ],
      {
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
        timeout: 12000,
      },
    )
    if (!String(stdout || '').trim()) return null
    const data = JSON.parse(stdout)
    const tags = { ...(data?.format?.tags || {}) }
    for (const stream of data?.streams || []) {
      if (stream?.tags && typeof stream.tags === 'object') {
        Object.assign(tags, stream.tags)
      }
    }
    const point = scanTagsForIso6709(tags) || looksLikeCoordPair(tags)
    return {
      point: point || null,
      cleanMiss: !point,
      source: 'ffprobe',
    }
  } catch {
    return null
  } finally {
    releaseTool()
  }
}

/**
 * @returns {Promise<{ point: {latitude:number,longitude:number}|null, cleanMiss: boolean, source: string } | null>}
 */
export async function extractWithExiftool(path) {
  const exe = await resolveExiftool()
  if (!exe) return null
  await acquireTool()
  try {
    const { stdout } = await execFileAsync(
      exe,
      [
        '-n',
        '-fast2',
        '-json',
        '-GPSLatitude',
        '-GPSLongitude',
        '-GPSAltitude',
        '-GPSPosition',
        '-Keys:GPSCoordinates',
        '-ItemList:GPSCoordinates',
        '-UserData:GPSCoordinates',
        '-Location',
        '-LocationShown',
        path,
      ],
      {
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        timeout: 15000,
      },
    )
    if (!String(stdout || '').trim()) return null
    const data = JSON.parse(stdout)
    const meta = Array.isArray(data) ? data[0] : null
    if (!meta) return null

    let lat = meta.GPSLatitude
    let lon = meta.GPSLongitude
    if (lat == null || lon == null) {
      for (const key of [
        'GPSCoordinates',
        'GPSPosition',
        'Location',
        'LocationShown',
      ]) {
        const raw = meta[key]
        if (!raw || typeof raw !== 'string') continue
        const parsed = parseIso6709(raw.replace(/\s+/g, ''))
        if (parsed) {
          lat = parsed.latitude
          lon = parsed.longitude
          break
        }
        const parts = raw.match(/[+-]?\d+(?:\.\d+)?/g)
        if (parts && parts.length >= 2) {
          lat = Number(parts[0])
          lon = Number(parts[1])
          break
        }
      }
    }
    const point = gps(lat, lon)
    return {
      point: point || null,
      cleanMiss: !point,
      source: 'exiftool',
    }
  } catch {
    return null
  } finally {
    releaseTool()
  }
}

/**
 * Video konteyner GPS: ffprobe → (yalnızca okunamadıysa) ExifTool.
 * Clean miss’te yavaş yola düşmez.
 */
export async function extractVideoContainerGps(path) {
  const fast = await extractWithFfprobe(path)
  if (fast?.point) return fast.point
  if (fast?.cleanMiss) return null
  const slow = await extractWithExiftool(path)
  return slow?.point ?? null
}

/**
 * Fotoğraf yedek: ExifTool -fast2 (exifr/HEIC sonrası).
 */
export async function extractPhotoGpsFallback(path) {
  const result = await extractWithExiftool(path)
  return result?.point ?? null
}

export async function availableFastBackends() {
  return {
    ffprobe: Boolean(await resolveFfprobe()),
    exiftool: Boolean(await resolveExiftool()),
  }
}
