import { createServer } from 'node:http'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import exifr from 'exifr'
import ffmpegPath from 'ffmpeg-static'

const execFileAsync = promisify(execFile)

/** Windows sürücülerini birim adıyla listeler. */
async function listDrives() {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID, VolumeName, DriveType, Size, FreeSpace | ConvertTo-Json -Compress',
      ],
      { windowsHide: true, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
    )
    const parsed = JSON.parse(stdout || '[]')
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
    return rows
      .filter((disk) => disk?.DeviceID)
      .map((disk) => {
        const letter = String(disk.DeviceID).replace(/:\\?$/, '').toUpperCase()
        const path = `${letter}:\\`
        const volumeName = String(disk.VolumeName || '').trim()
        const label = volumeName ? `${letter}: (${volumeName})` : `${letter}:`
        return {
          letter,
          path,
          volumeName: volumeName || null,
          label,
          driveType: Number(disk.DriveType) || null,
          size: Number(disk.Size) || null,
          freeSpace: Number(disk.FreeSpace) || null,
        }
      })
  } catch {
    const drives = []
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const path = `${letter}:\\`
      try {
        await access(path)
        drives.push({
          letter,
          path,
          volumeName: null,
          label: `${letter}:`,
          driveType: null,
          size: null,
          freeSpace: null,
        })
      } catch { /* yok */ }
    }
    return drives
  }
}

const media = new Map()
const jobs = new Map()
/** key → Promise<outputPath> — aynı dosya için tek ffmpeg süreci */
const transcodePromises = new Map()
/** jobId → { key, phase, done, url, error, percent } */
const transcodeJobs = new Map()
const transcodeDir = resolve(tmpdir(), 'MediaAtlas-transcodes')
const thumbDir = resolve(tmpdir(), 'MediaAtlas-thumbs')
const photoExt = new Set('jpg jpeg jpe png webp heic heif tif tiff dng gpr arw cr2 cr3 nef nrw orf raf rw2 pef srw x3f 3fr iiQ rwl avif gif bmp jxl'.split(' '))
const videoExt = new Set('mp4 mov m4v avi mkv webm 360 insv ts mts m2ts 3gp 3g2 wmv flv mpg mpeg m2v mod tod divx'.split(' '))
const skipDirs = new Set(['$recycle.bin', 'system volume information', 'windows', 'program files', 'programdata', '.git', 'node_modules'])
/** id → jpeg path */
const thumbs = new Map()

function kindFor(name) {
  const ext = extname(name).slice(1).toLowerCase()
  if (photoExt.has(ext)) return 'photo'
  if (!videoExt.has(ext)) return null
  const stem = name.replace(/\.[^.]+$/, '')
  if (/^DJI[_-]/i.test(stem)) return 'drone'
  return /^(gopr|g[xhs]\d{6}|gpfr|gp\d{6}|go\d{6})/i.test(stem) ? 'gopro' : 'video'
}

function mimeFor(path) {
  const ext = extname(path).slice(1).toLowerCase()
  return ({ mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo', mkv: 'video/x-matroska', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' })[ext] || 'application/octet-stream'
}

async function streamMedia(req, res, path) {
  const info = await stat(path)
  const range = req.headers.range
  const baseHeaders = { 'Content-Type': mimeFor(path), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }
  if (!range) { res.writeHead(200, { ...baseHeaders, 'Content-Length': info.size }); createReadStream(path).pipe(res); return }
  const match = /bytes=(\d*)-(\d*)/.exec(range)
  const start = Math.min(Number(match?.[1] || 0), Math.max(0, info.size - 1))
  const end = Math.min(Number(match?.[2] || info.size - 1), info.size - 1)
  if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return }
  res.writeHead(206, { ...baseHeaders, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 })
  createReadStream(path, { start, end }).pipe(res)
}

function transcodedUrl(key) {
  return `/api/transcoded/${key}.mp4`
}

/**
 * rootPath + relativePath adaylarını üretir (root dışında kalanlar elenir).
 *
 * Windows tuzakları:
 * - Sürücü kökü "E:\\" resolve sonrası "E:\\" kalır; ayraç normalize edilmeli.
 * - Baştaki "/" path.resolve'u kökü yok saydırır (E:\\GX.mp4 gibi).
 * - relativePath bazen kök klasör adını tekrar içerir (100GOPRO/GX.mp4).
 * - Büyük/küçük harf Windows'ta eşleşmeli.
 */
function pathUnderRoot(candidate, root) {
  const left = resolve(candidate)
  const right = resolve(root)
  const normRoot = right.endsWith(sep) ? right.slice(0, -1) : right
  const a = left.toLowerCase()
  const b = normRoot.toLowerCase()
  return a === b || a.startsWith(`${b}${sep.toLowerCase()}`)
}

function candidatePathsWithinRoot(rootPath, relativePath) {
  if (!rootPath || relativePath == null || relativePath === '') return []
  const root = resolve(rootPath)
  const normalizedRoot = root.endsWith(sep) ? root.slice(0, -1) : root
  const raw = String(relativePath).trim()
  const ordered = []

  const push = (input) => {
    if (!input) return
    if (!pathUnderRoot(input, normalizedRoot)) return
    if (!ordered.some((x) => x.toLowerCase() === input.toLowerCase())) ordered.push(input)
  }

  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    push(resolve(raw))
  }

  const rel = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  if (rel) push(resolve(root, rel))

  const rootName = normalizedRoot.split(/[\\/]/).filter(Boolean).pop()
  if (rootName && rel.toLowerCase().startsWith(`${rootName.toLowerCase()}/`)) {
    push(resolve(root, rel.slice(rootName.length + 1)))
  }

  // Basename yedeği yalnızca göreli yollarda; başka sürücüdeki absolute path'i
  // aynı isimli dosyaya bağlama.
  if (!/^[a-zA-Z]:[\\/]/.test(raw) && !raw.startsWith('\\\\')) {
    const base = basename(rel)
    if (base && base !== rel) push(resolve(root, base))
  }

  return ordered
}

function resolveWithinRoot(rootPath, relativePath) {
  return candidatePathsWithinRoot(rootPath, relativePath)[0] ?? null
}

async function resolveExistingWithinRoot(rootPath, relativePath) {
  for (const candidate of candidatePathsWithinRoot(rootPath, relativePath)) {
    try {
      const info = await stat(candidate)
      if (info.isFile()) return candidate
    } catch { /* sonraki aday */ }
  }
  return null
}

function parseFfmpegPercent(stderrChunk, durationSec) {
  if (!durationSec || durationSec <= 0) return null
  const match = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderrChunk)
  if (!match) return null
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  if (!Number.isFinite(seconds)) return null
  return Math.max(0, Math.min(99, Math.round((seconds / durationSec) * 100)))
}

/**
 * GoPro HEVC → Chrome'un oynattığı H.264/AAC.
 * 4K'yi en fazla 1920 genişliğe indirir (hız + uyumluluk).
 */
function runFfmpegTranscode(input, output, onProgress) {
  if (!ffmpegPath) return Promise.reject(new Error('Video converter is unavailable.'))
  return new Promise((resolveJob, rejectJob) => {
    const args = [
      '-y',
      '-i', input,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      // Uygulama içindeki amaç tam kalite arşiv oynatıcı olmak değil; hızlı
      // bir görsel önizleme vermek. 480p/24fps, GoPro ve iPhone HEVC
      // videolarında dönüştürme süresini belirgin biçimde azaltır.
      '-vf', 'scale=854:480:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=24',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '30',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'main',
      '-level', '4.0',
      '-c:a', 'aac',
      '-ac', '2',
      '-b:a', '128k',
      '-movflags', '+faststart',
      output,
    ]
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    let durationSec = null
    child.stderr.on('data', (chunk) => {
      const text = String(chunk)
      stderr = (stderr + text).slice(-4000)
      if (durationSec == null) {
        const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
        if (dur) {
          durationSec = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])
        }
      }
      const percent = parseFfmpegPercent(text, durationSec)
      if (percent != null) onProgress?.(percent)
    })
    child.on('error', rejectJob)
    child.on('close', (code) => {
      if (code === 0) resolveJob(output)
      else rejectJob(new Error(stderr.slice(-800) || 'Video conversion failed.'))
    })
  })
}

/** Galeri için tek kare JPEG — tarayıcı HEVC çözemezken ffmpeg çözer. */
const thumbJobs = new Map()
let thumbActive = 0
const thumbWait = []
const THUMB_MAX = 3
const THUMB_TIMEOUT_MS = 10000

async function acquireThumbSlot() {
  if (thumbActive >= THUMB_MAX) {
    await new Promise((resolve) => thumbWait.push(resolve))
  }
  thumbActive += 1
}

function releaseThumbSlot() {
  thumbActive = Math.max(0, thumbActive - 1)
  const next = thumbWait.shift()
  if (next) next()
}

function extractVideoThumb(input, output) {
  if (!ffmpegPath) return Promise.reject(new Error('ffmpeg yok.'))
  return new Promise((resolveJob, rejectJob) => {
    // -ss input öncesi: hızlı; düşük çözünürlük galeri için yeterli
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-ss', '0.5',
      '-i', input,
      '-frames:v', '1',
      '-vf', 'scale=240:-2:force_original_aspect_ratio=decrease',
      '-q:v', '6',
      output,
    ]
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    let settled = false
    const finish = (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err) rejectJob(err)
      else resolveJob()
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* */ }
      finish(new Error('Thumb zaman aşımı'))
    }, THUMB_TIMEOUT_MS)
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-2000)
    })
    child.on('error', (err) => finish(err))
    child.on('close', (code) => {
      if (code === 0) finish(null)
      else finish(new Error(stderr.slice(-400) || `ffmpeg thumb exit ${code}`))
    })
  })
}

async function thumbForMedia(id, path) {
  await mkdir(thumbDir, { recursive: true })
  // mtime id'de değişse bile aynı dosya → aynı önbellek (yeniden encode yok)
  let size = 0
  try {
    size = (await stat(path)).size
  } catch { /* */ }
  const key = createHash('sha1').update(`${path}|${size}`).digest('hex').slice(0, 24)
  const out = resolve(thumbDir, `${key}.jpg`)
  try {
    const info = await stat(out)
    if (info.size > 64) {
      thumbs.set(id, out)
      return { url: `/api/thumbs/${key}.jpg`, cached: true }
    }
  } catch { /* yok */ }

  const existing = thumbJobs.get(key)
  if (existing) return existing

  const job = (async () => {
    await acquireThumbSlot()
    try {
      try {
        const info = await stat(out)
        if (info.size > 64) {
          thumbs.set(id, out)
          return { url: `/api/thumbs/${key}.jpg`, cached: true }
        }
      } catch { /* */ }
      await extractVideoThumb(path, out)
      thumbs.set(id, out)
      return { url: `/api/thumbs/${key}.jpg` }
    } finally {
      releaseThumbSlot()
      thumbJobs.delete(key)
    }
  })()
  thumbJobs.set(key, job)
  return job
}

async function cachedOrTranscode(input, key, jobState) {
  await mkdir(transcodeDir, { recursive: true })
  const output = resolve(transcodeDir, `${key}.mp4`)
  try {
    const outputInfo = await stat(output)
    if (outputInfo.size > 1024) {
      if (jobState) {
        jobState.phase = 'done'
        jobState.done = true
        jobState.percent = 100
        jobState.url = transcodedUrl(key)
      }
      return output
    }
  } catch { /* henüz yok */ }

  let promise = transcodePromises.get(key)
  if (!promise) {
    promise = runFfmpegTranscode(input, output, (percent) => {
      if (jobState) {
        jobState.phase = 'converting'
        jobState.percent = percent
      }
    }).finally(() => transcodePromises.delete(key))
    transcodePromises.set(key, promise)
  }
  const path = await promise
  if (jobState) {
    jobState.phase = 'done'
    jobState.done = true
    jobState.percent = 100
    jobState.url = transcodedUrl(key)
  }
  return path
}

function startTranscodeJob(input, key) {
  const jobId = `${key}-${Date.now().toString(36)}`
  const jobState = {
    key,
    phase: 'queued',
    done: false,
    url: null,
    error: null,
    percent: 0,
  }
  transcodeJobs.set(jobId, jobState)
  cachedOrTranscode(input, key, jobState).catch((error) => {
    jobState.phase = 'error'
    jobState.done = true
    jobState.error = error instanceof Error ? error.message : 'Video conversion failed.'
  })
  return { jobId, key }
}

async function chromeCompatibleFromPath(id, rootPath, relativePath) {
  const input = await resolveExistingWithinRoot(rootPath, relativePath)
  if (!id || !input) {
    throw new Error('Invalid media path.')
  }
  const inputInfo = await stat(input)
  if (!inputInfo.isFile()) throw new Error('Media not found.')
  const key = createHash('sha1').update(`${input}|${inputInfo.size}|${inputInfo.mtimeMs}|preview-480p-v4`).digest('hex')
  const output = resolve(transcodeDir, `${key}.mp4`)
  try {
    const outputInfo = await stat(output)
    if (outputInfo.size > 1024) {
      return { cached: true, key, url: transcodedUrl(key) }
    }
  } catch { /* dönüştür */ }
  const started = startTranscodeJob(input, key)
  return { cached: false, ...started }
}

function gps(lat, lon) {
  lat = Number(lat); lon = Number(lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  if (Math.abs(lat) < .01 && Math.abs(lon) < .01) return null
  return { latitude: lat, longitude: lon }
}

function gpsFromText(text) {
  const named = /(?:latitude|lat)\s*[:=]\s*([+-]?\d{1,2}(?:\.\d+)?)[\s\S]{0,160}?(?:longitude|long|lon)\s*[:=]\s*([+-]?\d{1,3}(?:\.\d+)?)/i.exec(text)
  if (named) return gps(named[1], named[2])
  const iso = /([+-]\d{1,2}\.\d{4,})([+-]\d{1,3}\.\d{4,})(?:[+-]\d+(?:\.\d+)?)?\//.exec(text)
  return iso ? gps(iso[1], iso[2]) : null
}

/**
 * GoPro/MP4 creation_time — QuickTime spec: UTC.
 * Z yoksa UTC kabul et (yerel sanmak TR'de günü bir geri kaydırır).
 * Ham atomda bazen birden fazla etiket olur; 1970/epoch atlanır.
 */
function creationTimeFromText(text) {
  if (!text) return null
  const re = /creation_time\s*[:=]\s*(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/gi
  let best = null
  for (const match of text.matchAll(re)) {
    const raw0 = match[1].includes('T') ? match[1] : match[1].replace(' ', 'T')
    const iso = /Z$/i.test(raw0) ? raw0 : `${raw0}Z`
    const date = new Date(iso)
    if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1990) continue
    if (!best || date > best) best = date
  }
  return best
}

/**
 * Anı koruyan ISO. toISOString() + istemcide Z'siz yeniden parse
 * (veya yerel sanma) takvim gününü kaydırabiliyordu; offset ile yaz.
 */
function takenAtToIso(takenAt) {
  if (!(takenAt instanceof Date) || Number.isNaN(takenAt.getTime())) return null
  const off = -takenAt.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  const y = takenAt.getFullYear()
  const mo = String(takenAt.getMonth() + 1).padStart(2, '0')
  const d = String(takenAt.getDate()).padStart(2, '0')
  const h = String(takenAt.getHours()).padStart(2, '0')
  const mi = String(takenAt.getMinutes()).padStart(2, '0')
  const s = String(takenAt.getSeconds()).padStart(2, '0')
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${hh}:${mm}`
}

async function readFfmpegMetaText(path) {
  if (!ffmpegPath) return ''
  try {
    return await new Promise((resolveText) => {
      const child = spawn(ffmpegPath, ['-hide_banner', '-i', path], { windowsHide: true })
      let stderr = ''
      child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-12000) })
      child.on('close', () => resolveText(stderr))
      child.on('error', () => resolveText(''))
    })
  } catch {
    return ''
  }
}

async function readGpsFromFfmpeg(path) {
  return gpsFromText(await readFfmpegMetaText(path))
}

/** GoPro MP4 içinden ilk sabit GPS örneği (Node). Büyük dosyada yalnızca başı okur. */
async function readGoProGpsFromFile(path) {
  try {
    const [{ default: gpmfExtract }, goproTelemetry] = await Promise.all([
      import('gpmf-extract'),
      import('gopro-telemetry'),
    ])
    const info = await stat(path)
    const maxBytes = Math.min(info.size, 48 * 1024 * 1024)
    const fh = await open(path, 'r')
    let buf
    try {
      buf = Buffer.alloc(maxBytes)
      await fh.read(buf, 0, maxBytes, 0)
    } finally {
      await fh.close()
    }
    const file = new File([buf], basename(path), { type: 'video/mp4' })
    const extracted = await gpmfExtract(file)
    if (!extracted?.rawData) return null
    const parsed = await goproTelemetry.default(extracted, { stream: 'GPS5', append: false })
    const devices = parsed?.['1'] ? [parsed['1']] : Object.values(parsed || {})
    for (const device of devices) {
      const streams = device?.streams || {}
      const gpsStream = streams.GPS5 || streams.GPS9 || streams.GPS
      const samples = gpsStream?.samples
      if (!Array.isArray(samples)) continue
      for (const sample of samples) {
        const value = sample?.value
        let lat
        let lon
        if (Array.isArray(value) && value.length >= 2) {
          lat = value[0]
          lon = value[1]
        } else if (value && typeof value === 'object') {
          lat = value.latitude ?? value.lat
          lon = value.longitude ?? value.lon ?? value.lng
        }
        const point = gps(lat, lon)
        if (!point) continue
        const takenAt =
          sample.date instanceof Date
            ? sample.date
            : typeof sample.date === 'string'
              ? new Date(sample.date)
              : null
        return { ...point, takenAt: takenAt && !Number.isNaN(takenAt.getTime()) ? takenAt : null }
      }
    }
  } catch {
    return null
  }
  return null
}

async function readPhotoMeta(path) {
  try {
    // pick kullanma: latitude/longitude türetilmiş alanlar; pick GPS'i düşürebilir.
    const [pointRaw, exif] = await Promise.all([
      exifr.gps(path).catch(() => null),
      exifr.parse(path, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] }).catch(() => null),
    ])
    const point = gps(pointRaw?.latitude, pointRaw?.longitude)
    let takenAt = null
    const raw = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) takenAt = raw
    else if (typeof raw === 'string') {
      const date = new Date(raw)
      if (!Number.isNaN(date.getTime())) takenAt = date
    }
    return { point, takenAt }
  } catch {
    return { point: null, takenAt: null }
  }
}

async function readVideoMeta(path, kind) {
  let point = null
  let takenAt = null
  try {
    const info = await stat(path)
    const part = 1024 * 1024
    const file = await open(path, 'r')
    try {
      const headBytes = Math.min(part, info.size)
      const headBuffer = Buffer.alloc(headBytes)
      await file.read(headBuffer, 0, headBytes, 0)
      let text = headBuffer.toString('latin1')
      if (info.size > part) {
        const tailBytes = Math.min(part, info.size - headBytes)
        const tailBuffer = Buffer.alloc(tailBytes)
        await file.read(tailBuffer, 0, tailBytes, info.size - tailBytes)
        text += tailBuffer.toString('latin1')
      }
      point = gpsFromText(text)
      takenAt = creationTimeFromText(text)
    } finally {
      await file.close()
    }
  } catch { /* yok say */ }

  // GoPro: GPMF telemetri (binary metin taraması yetmez)
  if (!point && kind === 'gopro') {
    try {
      const gopro = await readGoProGpsFromFile(path)
      if (gopro) {
        point = gps(gopro.latitude, gopro.longitude)
        // Tarih için creation_time tercih; GPS örneği yalnızca yedek
        takenAt = takenAt || gopro.takenAt || null
      }
    } catch { /* yok say */ }
  }

  // creation_time atomda yoksa ffmpeg etiketinden al (takvim günü için kritik)
  if (!takenAt && ffmpegPath) {
    try {
      takenAt = creationTimeFromText(await readFfmpegMetaText(path))
    } catch { /* yok say */ }
  }

  // DJI: ISO6709 bazen yalnızca ffmpeg etiketinde
  if (!point && kind === 'drone' && ffmpegPath) {
    try {
      const ff = await readFfmpegMetaText(path)
      point = point || gpsFromText(ff)
      takenAt = takenAt || creationTimeFromText(ff)
    } catch { /* yok say */ }
  }
  return { point, takenAt }
}

async function readGps(path, kind) {
  try {
    if (kind === 'photo') {
      const meta = await readPhotoMeta(path)
      return meta.point
    }
    const meta = await readVideoMeta(path, kind)
    return meta.point
  } catch { return null }
}

async function readTakenAt(path, kind) {
  try {
    if (kind === 'photo') {
      const meta = await readPhotoMeta(path)
      return meta.takenAt
    }
    const meta = await readVideoMeta(path, kind)
    return meta.takenAt
  } catch {
    return null
  }
}

async function walk(dir, files) {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory() && !entry.name.startsWith('.') && !skipDirs.has(entry.name.toLowerCase())) await walk(path, files)
    else if (entry.isFile() && kindFor(entry.name)) files.push(path)
  }
}

async function scan(root, sourceId, job) {
  root = resolve(root)
  const files = []; await walk(root, files)
  // LRV: düşük çözünürlüklü proxy — hiç indeksleme
  const scanFiles = files.filter((path) => extname(path).slice(1).toLowerCase() !== 'lrv')
  // Asıl amaç GoPro konumları: onları ve drone videolarını önce işle.
  const priority = (path) => {
    const kind = kindFor(basename(path))
    return kind === 'gopro' ? 0 : kind === 'drone' ? 1 : kind === 'photo' ? 2 : 3
  }
  scanFiles.sort((a, b) => priority(a) - priority(b))
  if (job.cancelled) {
    job.phase = 'cancelled'
    job.done = true
    return
  }
  job.total = scanFiles.length
  job.phase = 'scanning'
  let next = 0
  const workers = Math.min(12, Math.max(4, scanFiles.length))
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < scanFiles.length) {
      if (job.cancelled) return
      const path = scanFiles[next++], kind = kindFor(basename(path))
      let point = null
      let takenAt = null
      if (kind === 'photo') {
        const meta = await readPhotoMeta(path)
        point = meta.point
        takenAt = meta.takenAt
      } else {
        const meta = await readVideoMeta(path, kind)
        point = meta.point
        takenAt = meta.takenAt
      }
      if (job.cancelled) return
      job.processed += 1
      if (point) job.located += 1
      else job.missing += 1
      const info = await stat(path), rel = relative(root, path).replaceAll('\\', '/')
      const id = `${sourceId}|${rel}|${info.size}|${info.mtimeMs}`
      media.set(id, path)
      job.items.push({
        id,
        name: basename(path),
        relativePath: rel,
        sourceId,
        kind,
        available: true,
        latitude: point?.latitude ?? 0,
        longitude: point?.longitude ?? 0,
        locationMissing: !point,
        takenAt: takenAtToIso(takenAt ?? new Date(info.mtimeMs)),
        url: `/api/media/${encodeURIComponent(id)}`,
      })
    }
  }))
  if (job.cancelled) {
    job.phase = 'cancelled'
    job.done = true
    return
  }
  job.phase = 'done'
  job.done = true
}

function send(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': 'http://localhost:5173' }); res.end(JSON.stringify(value)) }
async function readBody(req) { const chunks = []; for await (const c of req) chunks.push(c); return JSON.parse(Buffer.concat(chunks).toString()) }

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true })
    if (req.method === 'GET' && url.pathname === '/api/drives') {
      return send(res, 200, { drives: await listDrives() })
    }
    if (req.method === 'POST' && url.pathname === '/api/availability') {
      const { sources } = await readBody(req)
      const available = []
      for (const source of Array.isArray(sources) ? sources : []) {
        try {
          if (!source?.id || !source?.path) continue
          await access(source.path)
          available.push(source.id)
        } catch { /* disk çıkarılmış veya yol artık yok */ }
      }
      return send(res, 200, { available })
    }
    if (req.method === 'POST' && url.pathname === '/api/scan') {
      const { path, sourceId } = await readBody(req)
      if (!path || !sourceId) return send(res, 400, { error: 'Klasör yolu gerekli.' })
      const jobId = `${sourceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const job = {
        phase: 'discovering',
        total: 0,
        processed: 0,
        located: 0,
        missing: 0,
        items: [],
        done: false,
        error: null,
        cancelled: false,
      }
      jobs.set(jobId, job)
      scan(path, sourceId, job).catch((error) => {
        job.error = error instanceof Error ? error.message : 'Scan failed.'
        job.done = true
        job.phase = 'error'
      })
      return send(res, 202, { jobId })
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/scan/') && url.pathname.endsWith('/cancel')) {
      const jobId = decodeURIComponent(url.pathname.slice('/api/scan/'.length, -'/cancel'.length))
      const job = jobs.get(jobId)
      if (!job) return send(res, 404, { error: 'Scan job not found.' })
      job.cancelled = true
      job.done = true
      job.phase = 'cancelled'
      return send(res, 200, { ok: true, cancelled: true })
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/scan/')) {
      const job = jobs.get(decodeURIComponent(url.pathname.slice(10)))
      if (!job) return send(res, 404, { error: 'Scan job not found.' })
      const after = Math.max(0, Number(url.searchParams.get('after') ?? '0') || 0)
      return send(res, 200, {
        phase: job.phase,
        total: job.total,
        processed: job.processed,
        located: job.located,
        missing: job.missing,
        items: job.items.slice(after),
        itemCount: job.items.length,
        done: job.done,
        error: job.error,
        cancelled: Boolean(job.cancelled),
      })
    }
    if (req.method === 'POST' && url.pathname === '/api/open') {
      const { id } = await readBody(req)
      const path = media.get(id)
      if (!path) return send(res, 404, { error: 'Media not found.' })
      const child = spawn('cmd.exe', ['/c', 'start', '', path], { detached: true, stdio: 'ignore' })
      child.unref()
      return send(res, 200, { ok: true })
    }
    if (req.method === 'POST' && url.pathname === '/api/reveal') {
      const { id, path: rawPath, rootPath, relativePath } = await readBody(req)
      let path = null
      if (typeof rawPath === 'string' && rawPath.trim()) {
        const candidate = resolve(rawPath.trim())
        try {
          const info = await stat(candidate)
          path = candidate
          if (!info.isFile() && !info.isDirectory()) path = null
        } catch {
          path = null
        }
      }
      if (!path && id) path = media.get(id) || null
      if (!path && rootPath && relativePath) {
        path = await resolveExistingWithinRoot(rootPath, relativePath)
        if (path && id) media.set(id, path)
      }
      if (!path) return send(res, 404, { error: 'Media not found.' })
      const info = await stat(path)
      const folder = info.isDirectory() ? path : dirname(path)
      // Dosya seçili gelsin (Explorer /select,PATH — ayrı argüman)
      if (info.isFile()) {
        spawn('explorer.exe', [`/select,${path}`], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        }).unref()
      } else {
        spawn('explorer.exe', [folder], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        }).unref()
      }
      return send(res, 200, { ok: true, path, folder, selected: info.isFile() })
    }
    if (req.method === 'POST' && url.pathname === '/api/resolve') {
      const { id, rootPath, relativePath } = await readBody(req)
      const path = await resolveExistingWithinRoot(rootPath, relativePath)
      if (!id || !path) {
        return send(res, 400, { error: 'Invalid media path.' })
      }
      const info = await stat(path)
      if (!info.isFile()) return send(res, 404, { error: 'Media not found.' })
      media.set(id, path)
      return send(res, 200, { url: `/api/media/${encodeURIComponent(id)}` })
    }
    if (req.method === 'POST' && url.pathname === '/api/thumb') {
      const { id, rootPath, relativePath } = await readBody(req)
      let path = id ? media.get(id) : null
      if (!path) path = await resolveExistingWithinRoot(rootPath, relativePath)
      if (!id || !path) return send(res, 400, { error: 'Invalid media path.' })
      media.set(id, path)
      try {
        const result = await thumbForMedia(id, path)
        return send(res, 200, result)
      } catch (error) {
        return send(res, 500, {
          error: error instanceof Error ? error.message : 'Thumb failed.',
        })
      }
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/thumbs/')) {
      const fileName = decodeURIComponent(url.pathname.slice('/api/thumbs/'.length))
      if (!/^[a-f0-9]{24}\.jpg$/i.test(fileName)) return send(res, 400, { error: 'Invalid thumb.' })
      const path = resolve(thumbDir, fileName)
      try {
        await access(path)
      } catch {
        return send(res, 404, { error: 'Thumb not found.' })
      }
      await streamMedia(req, res, path)
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/transcode') {
      const { id, rootPath, relativePath } = await readBody(req)
      const result = await chromeCompatibleFromPath(id, rootPath, relativePath)
      if (result.cached) return send(res, 200, { url: result.url, key: result.key, cached: true })
      return send(res, 202, { jobId: result.jobId, key: result.key })
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/transcode/')) {
      const jobId = decodeURIComponent(url.pathname.slice('/api/transcode/'.length))
      const job = transcodeJobs.get(jobId)
      if (!job) return send(res, 404, { error: 'Transcode job not found.' })
      return send(res, 200, {
        phase: job.phase,
        done: job.done,
        url: job.url,
        error: job.error,
        percent: job.percent,
        key: job.key,
      })
    }
    if (req.method === 'POST' && url.pathname === '/api/transcode-upload') {
      const name = basename(url.searchParams.get('name') || 'upload.mp4')
      await mkdir(transcodeDir, { recursive: true })
      const tmpPath = resolve(transcodeDir, `upload-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`)
      const hash = createHash('sha1')
      let size = 0
      const maxBytes = 400 * 1024 * 1024
      try {
        const counter = new Transform({
          transform(chunk, _enc, cb) {
            size += chunk.length
            if (size > maxBytes) {
              cb(new Error('Dosya çok büyük (en fazla 400 MB yüklenebilir). Sürücü yolu ile ekleyin.'))
              return
            }
            hash.update(chunk)
            cb(null, chunk)
          },
        })
        await pipeline(req, counter, createWriteStream(tmpPath))
      } catch (error) {
        try { await unlink(tmpPath) } catch { /* ignore */ }
        throw error
      }
      const key = hash.digest('hex')
      const inputFinal = resolve(transcodeDir, `src-${key}${extname(name) || '.mp4'}`)
      try {
        await rename(tmpPath, inputFinal)
      } catch {
        try { await unlink(tmpPath) } catch { /* ignore */ }
      }
      try {
        await access(inputFinal)
      } catch {
        return send(res, 500, { error: 'Upload kaydedilemedi.' })
      }
      try {
        const outputInfo = await stat(resolve(transcodeDir, `${key}.mp4`))
        if (outputInfo.size > 1024) return send(res, 200, { url: transcodedUrl(key), key, cached: true })
      } catch { /* dönüştür */ }
      const started = startTranscodeJob(inputFinal, key)
      return send(res, 202, { jobId: started.jobId, key })
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/transcoded/')) {
      const fileName = decodeURIComponent(url.pathname.slice('/api/transcoded/'.length))
      const key = fileName.replace(/\.mp4$/i, '')
      if (!/^[a-f0-9]{40}$/i.test(key)) return send(res, 400, { error: 'Invalid transcode key.' })
      const path = resolve(transcodeDir, `${key}.mp4`)
      try {
        await access(path)
      } catch {
        return send(res, 404, { error: 'Transcoded media not found.' })
      }
      await streamMedia(req, res, path)
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/media/')) {
      const path = media.get(decodeURIComponent(url.pathname.slice(11)))
      if (!path) return send(res, 404, { error: 'Medya bulunamadı.' })
      await streamMedia(req, res, path); return
    }
    return send(res, 404, { error: 'Bulunamadı.' })
  } catch (error) { return send(res, 500, { error: error instanceof Error ? error.message : 'Tarama hatası.' }) }
}).listen(Number(process.env.MEDIAATLAS_API_PORT || 5174), '127.0.0.1', () => {
  const port = Number(process.env.MEDIAATLAS_API_PORT || 5174)
  console.log(`MedyaAtlas yerel servis: ${port}`)
})
