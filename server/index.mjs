import { createServer } from 'node:http'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { execFile, exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { tmpdir, cpus, homedir } from 'node:os'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import exifr from 'exifr'
import ffmpegPath from 'ffmpeg-static'
import {
  extractWithLocationWorker,
  flushLocationCache,
  listMediaFilesWithWorker,
  locationWorkerAvailable,
  locationWorkerStatus,
  siblingExtractorAvailable,
} from './locationWorker.mjs'

process.on('uncaughtException', (err) => {
  console.error('[api] uncaughtException — süreç açık tutuluyor:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[api] unhandledRejection — süreç açık tutuluyor:', reason)
})

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

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
/** jobId → GPS yeniden okuma işi (Konum Bulucu worker) */
const gpsRetryJobs = new Map()
/** key → Promise<outputPath> — aynı dosya için tek ffmpeg süreci */
const transcodePromises = new Map()
/** jobId → { key, phase, done, url, error, percent } */
const transcodeJobs = new Map()
const transcodeDir = resolve(tmpdir(), 'MediaAtlas-transcodes')
const thumbDir = resolve(tmpdir(), 'MediaAtlas-thumbs')
const RIDE_EXTS = new Set(['.gpx', '.kml', '.kmz'])

/** Belgelerim\\MedyaAtlas — V2 yerel veri kökü. */
function documentsMedyaAtlasDir() {
  return join(homedir(), 'Documents', 'MedyaAtlas')
}

async function ensureMedyaAtlasDirs() {
  const root = documentsMedyaAtlasDir()
  const ridesDir = join(root, 'rides')
  const stateDir = join(root, 'state')
  await mkdir(ridesDir, { recursive: true })
  await mkdir(stateDir, { recursive: true })
  return { root, ridesDir, stateDir }
}

function safeRideFileName(name) {
  const base = basename(String(name || '').trim())
  if (!base || base === '.' || base === '..') return null
  if (base.includes('\0')) return null
  const ext = extname(base).toLowerCase()
  if (!RIDE_EXTS.has(ext)) return null
  return base
}

async function uniqueRidePath(ridesDir, fileName) {
  let dest = join(ridesDir, fileName)
  try {
    await access(dest)
  } catch {
    return dest
  }
  const ext = extname(fileName)
  const stem = basename(fileName, ext)
  return join(ridesDir, `${stem}-${Date.now()}${ext}`)
}
const photoExt = new Set('jpg jpeg jpe png webp heic heif tif tiff dng gpr arw cr2 cr3 nef nrw orf raf rw2 pef srw x3f 3fr iiQ rwl avif gif bmp jxl insp'.split(' '))
const videoExt = new Set('mp4 mov m4v avi mkv webm 360 insv ts mts m2ts 3gp 3g2 wmv flv mpg mpeg m2v mod tod divx'.split(' '))
/** id → jpeg path */
const thumbs = new Map()
/** Konum Bulucu ile aynı: 100 KB altı atlanır */
const MIN_MEDIA_BYTES = 100_000

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
  const origin = corsOrigin(req)
  const baseHeaders = {
    'Content-Type': mimeFor(path),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges',
    'Access-Control-Allow-Private-Network': 'true',
  }
  if (!range) {
    res.writeHead(200, { ...baseHeaders, 'Content-Length': info.size })
    createReadStream(path).pipe(res)
    return
  }
  const match = /bytes=(\d*)-(\d*)/.exec(range)
  const start = Math.min(Number(match?.[1] || 0), Math.max(0, info.size - 1))
  const end = Math.min(Number(match?.[2] || info.size - 1), info.size - 1)
  if (start > end) {
    res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${info.size}` })
    res.end()
    return
  }
  res.writeHead(206, {
    ...baseHeaders,
    'Content-Range': `bytes ${start}-${end}/${info.size}`,
    'Content-Length': end - start + 1,
  })
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

  // Kök ile göreli yol örtüşmesi: root=E:\DCIM\Camera, rel=DCIM/Camera/a.mp4
  const rootParts = normalizedRoot.split(/[\\/]/).filter(Boolean)
  const relParts = rel.split('/').filter(Boolean)
  const maxOverlap = Math.min(rootParts.length, relParts.length)
  for (let k = 1; k <= maxOverlap; k++) {
    const rootSuffix = rootParts.slice(-k).join('/').toLowerCase()
    const relPrefix = relParts.slice(0, k).join('/').toLowerCase()
    if (rootSuffix !== relPrefix) continue
    const stripped = relParts.slice(k).join('/')
    if (stripped) push(resolve(root, stripped))
    else push(normalizedRoot)
  }

  // Basename yedeği yalnızca göreli yollarda; başka sürücüdeki absolute path'i
  // aynı isimli dosyaya bağlama.
  if (!/^[a-zA-Z]:[\\/]/.test(raw) && !raw.startsWith('\\\\')) {
    const base = basename(rel)
    if (base && base !== rel) push(resolve(root, base))
  }

  return ordered
}

async function resolveExistingWithinRoot(rootPath, relativePath) {
  const raw = String(relativePath ?? '').trim()

  // Mutlak yol: kök dışında olsa bile diskte varsa kabul et (reveal / play)
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    const abs = normalizeRevealPath(raw)
    if (abs) {
      try {
        const info = await stat(abs)
        if (info.isFile()) return abs
      } catch {
        /* adaylara düş */
      }
    }
  }

  if (rootPath) {
    for (const candidate of candidatePathsWithinRoot(rootPath, relativePath)) {
      try {
        const info = await stat(candidate)
        if (info.isFile()) return candidate
      } catch {
        /* sonraki aday */
      }
    }
  }

  return null
}

/**
 * Windows Explorer için yolu normalize et.
 * `path.resolve` mutlak `E:\...` yollarında cwd karıştırmasın; sürücü kökü `E:\` kalsın.
 * UNC `\\server\share` öneki korunur (\\+ collapse bozmasın).
 */
function normalizeRevealPath(raw) {
  let s = String(raw).trim()
  if (!s) return null
  s = s.replace(/\//g, '\\')

  // UNC: \\server\share\... (fazla leading \ olsa bile tam iki bırak)
  if (s.startsWith('\\\\')) {
    const body = s.replace(/^\\+/, '').replace(/\\+/g, '\\').replace(/\\+$/, '')
    return body ? `\\\\${body}` : null
  }

  // Sürücü: E: / E:\ / E:\Photos
  const drive = /^([a-zA-Z]):(.*)$/.exec(s)
  if (drive) {
    const letter = drive[1].toUpperCase()
    let rest = (drive[2] || '').replace(/\\+/g, '\\')
    if (!rest || rest === '\\') return `${letter}:\\`
    rest = rest.replace(/\\+$/, '')
    if (!rest.startsWith('\\')) rest = `\\${rest}`
    return `${letter}:${rest}`
  }

  return resolve(s)
}

/**
 * Klasör/dosyayı Explorer’da aç.
 * Boşluklu `/select,` tırnaksız → Belgeler. SHOpenFolderAndSelectItems bunu aşar.
 * Yol UTF-8/Türkçe bozulmasın diye -TargetPath ile verilir (script içine gömülmez).
 */
async function openPathInExplorer(absPath, isFile) {
  const abs = String(absPath).replace(/\//g, '\\').replace(/"/g, '')
  let target = abs
  if (!isFile) {
    if (/^[a-zA-Z]:$/i.test(target)) target = `${target}\\`
    else if (!/^[a-zA-Z]:\\$/i.test(target)) target = target.replace(/[\\/]+$/, '')
  }

  try {
    await access(target)
  } catch {
    throw new Error(`Diskte yok: ${target}`)
  }

  const typeName = `NativeExplorer${Date.now().toString(36)}`
  const ps1 = `
param([Parameter(Mandatory=$true)][string]$TargetPath)
$ErrorActionPreference = 'Stop'
$p = $TargetPath
if (-not (Test-Path -LiteralPath $p)) { throw "Yol yok: $p" }
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ${typeName} {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr ILCreateFromPathW(string path);
  [DllImport("shell32.dll")]
  public static extern void ILFree(IntPtr pidl);
  [DllImport("shell32.dll")]
  public static extern int SHOpenFolderAndSelectItems(IntPtr pidlFolder, uint cidl, IntPtr apidl, uint dwFlags);
}
"@
$pidl = [${typeName}]::ILCreateFromPathW($p)
if ($pidl -eq [IntPtr]::Zero) { throw "PIDL olusturulamadi: $p" }
try {
  [void][${typeName}]::SHOpenFolderAndSelectItems($pidl, 0, [IntPtr]::Zero, 0)
} finally {
  [${typeName}]::ILFree($pidl)
}
`.trim()

  const ps1Path = join(tmpdir(), `medyaatlas-reveal-${process.pid}-${Date.now()}.ps1`)
  try {
    await writeFile(ps1Path, `\uFEFF${ps1}`, 'utf8')
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        ps1Path,
        '-TargetPath',
        target,
      ],
      { windowsHide: true, timeout: 30000, encoding: 'utf8' },
    )
    return
  } catch (err) {
    console.error('SHOpenFolderAndSelectItems başarısız:', err?.stderr || err?.message || err)
  } finally {
    try {
      await unlink(ps1Path)
    } catch {
      /* */
    }
  }

  // Yedek: tırnaklı /select
  const selectArg = isFile ? `/select,"${target}"` : `"${target}"`
  try {
    await execAsync(`explorer.exe ${selectArg}`, { windowsHide: false, timeout: 20000 })
  } catch (err) {
    const code = err && typeof err.code === 'number' ? err.code : null
    if (code === 1) return
    console.error('Explorer cmd yedek başarısız:', err?.message || err)
    throw err
  }
}

/** Windows klasör seçici — V2’de FSA yerine gerçek localPath almak için. */
async function pickFolderWindows() {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$d.Description = 'Medya klasörü seç'",
    '$d.ShowNewFolderButton = $true',
    'try { $d.UseDescriptionForTitle = $true } catch {}',
    'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  [Console]::Out.Write($d.SelectedPath)',
    '}',
  ].join('; ')
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-STA', '-Command', script],
      { windowsHide: false, encoding: 'utf8', timeout: 300000, maxBuffer: 1024 * 1024 },
    )
    const chosen = String(stdout || '').trim()
    return chosen || null
  } catch {
    return null
  }
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

async function chromeCompatibleFromPath(id, rootPath, relativePath, rawPath = null) {
  let input = null
  if (typeof rawPath === 'string' && rawPath.trim()) {
    const candidate = resolve(rawPath.trim())
    try {
      const info = await stat(candidate)
      if (info.isFile()) input = candidate
    } catch { /* */ }
  }
  if (!input && id) input = media.get(id) || null
  if (!input && rootPath && relativePath) {
    input = await resolveExistingWithinRoot(rootPath, relativePath)
    if (input && id) media.set(id, input)
  }
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

/**
 * GPS: yalnızca Konum Bulucu location_extractor (fast / deep / full).
 * @param {string} path
 * @param {{ force?: boolean, mode?: 'fast' | 'deep' | 'full' }} [options]
 */
async function readLocationLikeKonumBulucu(path, options = {}) {
  const workerUp = await locationWorkerAvailable()
  if (!workerUp) {
    return { point: null, takenAt: null, gpsExtractFailed: true, needsDeep: false }
  }
  try {
    const loc = await extractWithLocationWorker(path, {
      force: Boolean(options.force),
      mode: options.mode || 'full',
    })
    return {
      point: loc.point,
      takenAt: null,
      gpsExtractFailed: loc.gpsExtractFailed,
      needsDeep: loc.needsDeep,
    }
  } catch {
    return { point: null, takenAt: null, gpsExtractFailed: true, needsDeep: false }
  }
}

async function readPhotoTakenAt(path) {
  try {
    const exif = await exifr
      .parse(path, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] })
      .catch(() => null)
    const raw = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw
    if (typeof raw === 'string') {
      const date = new Date(raw)
      if (!Number.isNaN(date.getTime())) return date
    }
  } catch {
    /* */
  }
  return null
}

/**
 * @param {string} path
 * @param {string | null} kind
 * @param {{ force?: boolean, mode?: 'fast' | 'deep' | 'full' }} [options]
 */
async function readMediaMeta(path, kind, options = {}) {
  const loc = await readLocationLikeKonumBulucu(path, options)
  let takenAt = null
  if (kind === 'photo') takenAt = await readPhotoTakenAt(path)
  return {
    point: loc.point,
    takenAt,
    gpsExtractFailed: loc.gpsExtractFailed,
    needsDeep: loc.needsDeep,
  }
}

function pushScanItem(job, { id, path, rel, sourceId, kind, point, takenAt, info, gpsExtractFailed }) {
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
    gpsExtractFailed: !point && Boolean(gpsExtractFailed),
    takenAt: takenAtToIso(takenAt ?? new Date(info.mtimeMs)),
    url: `/api/media/${encodeURIComponent(id)}`,
  })
}

async function scan(root, sourceId, job, known = null, opts = null) {
  const forceRetry = Boolean(opts?.forceGoProRetry)
  root = resolve(root)
  job.phase = 'discovering'

  const workerUp = await locationWorkerAvailable()
  if (!workerUp) {
    job.error = 'Konum Bulucu worker açılamadı — baslat-v2.bat ve kardeş proje (video daki konum neresi) gerekli.'
    job.phase = 'error'
    job.done = true
    return
  }

  let scanFiles
  try {
    scanFiles = await listMediaFilesWithWorker(root, {
      recursive: true,
      includeInsv: Boolean(opts?.includeInsv),
    })
  } catch (err) {
    job.error = err instanceof Error ? err.message : 'Medya listesi alınamadı.'
    job.phase = 'error'
    job.done = true
    return
  }

  // Min boyut yedeği (worker zaten 100KB; Node kind’sız uzantı elensin)
  const filtered = []
  for (const path of scanFiles) {
    if (job.cancelled) break
    if (!kindFor(basename(path))) continue
    if (extname(path).slice(1).toLowerCase() === 'lrv') continue
    filtered.push(path)
    job.total = filtered.length
  }
  scanFiles = filtered

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
  job.phase = 'scanning_fast'

  /** @type {Array<{ path: string, kind: string, info: import('node:fs').Stats, rel: string, id: string, itemIndex: number, needsDeep: boolean }>} */
  const deepQueue = []
  const cpuCount = cpus()?.length ?? 4
  const workers = Math.min(8, Math.max(4, cpuCount), scanFiles.length || 1)

  // —— Pass 1: fast ——
  let next = 0
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < scanFiles.length) {
      if (job.cancelled) return
      const path = scanFiles[next++]
      const kind = kindFor(basename(path)) || 'video'
      let info
      try {
        info = await stat(path)
      } catch {
        job.processed += 1
        job.missing += 1
        continue
      }
      if (info.size < MIN_MEDIA_BYTES) {
        job.processed += 1
        job.missing += 1
        continue
      }
      const rel = relative(root, path).replaceAll('\\', '/')
      const relKey = rel.toLowerCase()
      const id = `${sourceId}|${rel}|${info.size}|${info.mtimeMs}`

      const prev = known && typeof known === 'object' ? known[relKey] : null
      let point = null
      let takenAt = null
      let gpsExtractFailed = false
      let needsDeep = false
      const unchanged =
        prev &&
        Number(prev.size) === info.size &&
        Number(prev.mtimeMs) === info.mtimeMs
      if (unchanged && prev.locationMissing === false && !forceRetry) {
        const kept = gps(prev.latitude, prev.longitude)
        const keep =
          kept &&
          !(
            kind === 'drone' &&
            (Math.abs(kept.latitude) < 0.5 || Math.abs(kept.longitude) < 0.5)
          )
        if (keep) {
          point = kept
          takenAt = prev.takenAt ? new Date(prev.takenAt) : null
          if (takenAt && Number.isNaN(takenAt.getTime())) takenAt = null
        }
      }

      if (!point) {
        const meta = await readMediaMeta(path, kind, {
          mode: 'fast',
          force: forceRetry,
        })
        point = meta.point
        takenAt = meta.takenAt
        gpsExtractFailed = Boolean(meta.gpsExtractFailed)
        needsDeep = Boolean(meta.needsDeep) && !point && !gpsExtractFailed
      }

      if (job.cancelled) return
      job.processed += 1
      if (point) job.located += 1
      else job.missing += 1

      const itemIndex = job.items.length
      pushScanItem(job, {
        id,
        path,
        rel,
        sourceId,
        kind,
        point,
        takenAt,
        info,
        gpsExtractFailed,
      })
      if (needsDeep) {
        deepQueue.push({ path, kind, info, rel, id, itemIndex, needsDeep: true })
      }
    }
  }))

  if (job.cancelled) {
    job.phase = 'cancelled'
    job.done = true
    return
  }

  // —— Pass 2: deep (yalnızca needs_deep) ——
  if (deepQueue.length > 0) {
    job.phase = 'scanning_deep'
    // processed sayacı deep için toplamın üstüne binmesin; located/missing güncelle
    let deepNext = 0
    const deepWorkers = Math.min(workers, deepQueue.length)
    await Promise.all(Array.from({ length: deepWorkers }, async () => {
      while (deepNext < deepQueue.length) {
        if (job.cancelled) return
        const entry = deepQueue[deepNext++]
        const meta = await readMediaMeta(entry.path, entry.kind, {
          mode: 'deep',
          force: forceRetry,
        })
        const item = job.items[entry.itemIndex]
        if (!item) continue
        const hadPoint = !item.locationMissing
        if (meta.point) {
          item.latitude = meta.point.latitude
          item.longitude = meta.point.longitude
          item.locationMissing = false
          item.gpsExtractFailed = false
          if (!hadPoint) {
            job.located += 1
            job.missing = Math.max(0, job.missing - 1)
          }
        } else {
          item.gpsExtractFailed = Boolean(meta.gpsExtractFailed)
          item.locationMissing = true
        }
        if (meta.takenAt) item.takenAt = takenAtToIso(meta.takenAt)
      }
    }))
  }

  await flushLocationCache()

  if (job.cancelled) {
    job.phase = 'cancelled'
    job.done = true
    return
  }
  job.phase = 'done'
  job.done = true
}

function corsOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return '*'
  // Yerel Vite V1/V2 + LAN (telefon aynı Wi‑Fi)
  if (
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin) ||
    /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(origin)
  ) {
    return origin
  }
  return 'http://localhost:5173'
}

function send(res, code, value, req) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': req ? corsOrigin(req) : '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
  })
  res.end(JSON.stringify(value))
}
async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString()
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': corsOrigin(req),
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Range',
        'Access-Control-Allow-Private-Network': 'true',
      })
      return res.end()
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const workerUp = await locationWorkerAvailable()
      const sibling = await siblingExtractorAvailable()
      const status = locationWorkerStatus()
      return send(
        res,
        workerUp ? 200 : 503,
        {
          ok: workerUp,
          locationWorker: {
            ...status,
            sibling,
            required: true,
            engine: 'konum-bulucu',
          },
          error: workerUp
            ? null
            : 'Konum Bulucu worker yok — baslat-v2.bat ve “video daki konum neresi” gerekli.',
        },
        req,
      )
    }
    if (req.method === 'GET' && url.pathname === '/api/drives') {
      return send(res, 200, { drives: await listDrives() })
    }

    if (req.method === 'GET' && url.pathname === '/api/data-dir') {
      const dirs = await ensureMedyaAtlasDirs()
      return send(
        res,
        200,
        {
          ok: true,
          root: dirs.root,
          ridesDir: dirs.ridesDir,
          stateDir: dirs.stateDir,
        },
        req,
      )
    }

    if (req.method === 'GET' && url.pathname === '/api/rides') {
      const { root, ridesDir } = await ensureMedyaAtlasDirs()
      const names = await readdir(ridesDir)
      const rides = []
      for (const name of names) {
        if (!safeRideFileName(name)) continue
        const full = join(ridesDir, name)
        try {
          const st = await stat(full)
          if (!st.isFile()) continue
          rides.push({
            fileName: name,
            path: full,
            size: st.size,
            mtimeMs: st.mtimeMs,
          })
        } catch {
          /* atla */
        }
      }
      rides.sort((a, b) => a.fileName.localeCompare(b.fileName, 'tr'))
      return send(res, 200, { ok: true, root, ridesDir, rides }, req)
    }

    if (req.method === 'GET' && url.pathname === '/api/rides/raw') {
      const fileName = safeRideFileName(url.searchParams.get('name') || '')
      if (!fileName) return send(res, 400, { error: 'name gerekli (gpx/kml/kmz).' }, req)
      const { ridesDir } = await ensureMedyaAtlasDirs()
      const full = join(ridesDir, fileName)
      if (resolve(full) !== resolve(join(ridesDir, fileName))) {
        return send(res, 400, { error: 'Geçersiz dosya adı.' }, req)
      }
      try {
        await access(full)
      } catch {
        return send(res, 404, { error: 'Ride dosyası yok.' }, req)
      }
      const st = await stat(full)
      const ext = extname(fileName).toLowerCase()
      const type =
        ext === '.gpx'
          ? 'application/gpx+xml'
          : ext === '.kml'
            ? 'application/vnd.google-earth.kml+xml'
            : 'application/vnd.google-earth.kmz'
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': st.size,
        'Access-Control-Allow-Origin': corsOrigin(req),
        'Access-Control-Allow-Private-Network': 'true',
        'Cache-Control': 'no-store',
      })
      return createReadStream(full).pipe(res)
    }

    if (req.method === 'POST' && url.pathname === '/api/rides/import') {
      const body = await readBody(req)
      const fileName = safeRideFileName(body?.fileName)
      const contentBase64 = typeof body?.contentBase64 === 'string' ? body.contentBase64 : ''
      if (!fileName) {
        return send(res, 400, { error: 'fileName gerekli (gpx/kml/kmz).' }, req)
      }
      if (!contentBase64) {
        return send(res, 400, { error: 'contentBase64 gerekli.' }, req)
      }
      let buf
      try {
        buf = Buffer.from(contentBase64, 'base64')
      } catch {
        return send(res, 400, { error: 'contentBase64 geçersiz.' }, req)
      }
      if (buf.length === 0) {
        return send(res, 400, { error: 'Dosya boş.' }, req)
      }
      if (buf.length > 80 * 1024 * 1024) {
        return send(res, 413, { error: 'Ride dosyası çok büyük (max 80 MB).' }, req)
      }
      const { root, ridesDir } = await ensureMedyaAtlasDirs()
      const dest = await uniqueRidePath(ridesDir, fileName)
      await writeFile(dest, buf)
      return send(
        res,
        200,
        {
          ok: true,
          root,
          path: dest,
          fileName: basename(dest),
          size: buf.length,
        },
        req,
      )
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
      const { path, sourceId, known, forceGoProRetry, includeInsv } = await readBody(req)
      if (!path || !sourceId) return send(res, 400, { error: 'Klasör yolu gerekli.' })
      if (!(await locationWorkerAvailable())) {
        return send(
          res,
          503,
          {
            error:
              'Konum Bulucu worker açılamadı. baslat-v2.bat ve kardeş proje “video daki konum neresi” gerekli.',
          },
          req,
        )
      }
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
      scan(
        path,
        sourceId,
        job,
        known && typeof known === 'object' ? known : null,
        {
          forceGoProRetry: Boolean(forceGoProRetry),
          includeInsv: Boolean(includeInsv),
        },
      ).catch((error) => {
        job.error = error instanceof Error ? error.message : 'Scan failed.'
        job.done = true
        job.phase = 'error'
      })
      return send(res, 202, { jobId })
    }
    if (req.method === 'POST' && (url.pathname === '/api/gps-retry' || url.pathname === '/api/gopro-gps')) {
      const { paths } = await readBody(req)
      if (!Array.isArray(paths) || paths.length === 0) {
        return send(res, 400, { error: 'paths gerekli.' }, req)
      }
      if (!(await locationWorkerAvailable())) {
        return send(
          res,
          503,
          {
            error:
              'Konum Bulucu worker açılamadı. baslat-v2.bat ve “video daki konum neresi” gerekli.',
          },
          req,
        )
      }
      const list = [...new Set(
        paths
          .filter((p) => typeof p === 'string' && p.trim())
          .map((p) => String(p).trim())
          .slice(0, 2000),
      )]
      const jobId = `gps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const job = {
        phase: 'running',
        total: list.length,
        processed: 0,
        located: 0,
        missing: 0,
        failed: 0,
        /** @type {Array<{ path: string, ok: boolean, latitude?: number, longitude?: number, locationMissing?: boolean, takenAt?: string | null, error?: string }>} */
        results: [],
        done: false,
        error: null,
        cancelled: false,
      }
      gpsRetryJobs.set(jobId, job)

      const extractOne = async (filePath) => {
        const loc = await extractWithLocationWorker(filePath, {
          force: true,
          mode: 'full',
        })
        if (loc.gpsExtractFailed) {
          return {
            path: filePath,
            ok: false,
            error: 'Konum Bulucu GPS okuyamadı',
          }
        }
        if (loc.point) {
          return {
            path: filePath,
            ok: true,
            latitude: loc.point.latitude,
            longitude: loc.point.longitude,
            locationMissing: false,
          }
        }
        return { path: filePath, ok: true, locationMissing: true }
      }

      void (async () => {
        let next = 0
        const workers = Math.min(6, list.length || 1)
        await Promise.all(Array.from({ length: workers }, async () => {
          while (next < list.length) {
            if (job.cancelled) return
            const i = next++
            const filePath = list[i]
            let row
            try {
              await access(filePath)
            } catch {
              row = { path: filePath, ok: false, error: 'Dosya bulunamadı.' }
            }
            if (!row) {
              try {
                row = await extractOne(filePath)
              } catch (err) {
                row = {
                  path: filePath,
                  ok: false,
                  error: err instanceof Error ? err.message : 'GPS okunamadı',
                }
              }
            }
            job.results.push(row)
            job.processed += 1
            if (row.ok && !row.locationMissing) job.located += 1
            else if (row.ok) job.missing += 1
            else job.failed += 1
          }
        }))
        await flushLocationCache()
        job.done = true
        job.phase = job.cancelled ? 'cancelled' : 'done'
        // Bellekte birikmesin — 30 dk sonra sil
        setTimeout(() => gpsRetryJobs.delete(jobId), 30 * 60 * 1000).unref?.()
      })().catch((error) => {
        job.error = error instanceof Error ? error.message : 'GPS yeniden okuma başarısız.'
        job.done = true
        job.phase = 'error'
      })

      return send(res, 202, { jobId }, req)
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/gps-retry/')) {
      const jobId = decodeURIComponent(url.pathname.slice('/api/gps-retry/'.length))
      const job = gpsRetryJobs.get(jobId)
      if (!job) return send(res, 404, { error: 'GPS işi bulunamadı (API yeniden başladıysa tekrar dene).' }, req)
      const after = Math.max(0, Number(url.searchParams.get('after') ?? '0') || 0)
      return send(res, 200, {
        phase: job.phase,
        total: job.total,
        processed: job.processed,
        located: job.located,
        missing: job.missing,
        failed: job.failed,
        results: job.results.slice(after),
        resultCount: job.results.length,
        done: job.done,
        error: job.error,
        cancelled: Boolean(job.cancelled),
      }, req)
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
    if (req.method === 'POST' && url.pathname === '/api/pick-folder') {
      const chosen = await pickFolderWindows()
      if (!chosen) return send(res, 200, { cancelled: true }, req)
      return send(res, 200, { path: chosen }, req)
    }
    if (req.method === 'POST' && url.pathname === '/api/open') {
      const { id } = await readBody(req)
      const path = media.get(id)
      if (!path) return send(res, 404, { error: 'Media not found.' }, req)
      await openPathInExplorer(path, true)
      return send(res, 200, { ok: true }, req)
    }
    if (req.method === 'POST' && url.pathname === '/api/play') {
      const body = await readBody(req)
      const { id, path: rawPath, rootPath, relativePath, player } = body
      let path = null
      if (typeof rawPath === 'string' && rawPath.trim()) {
        const candidate = resolve(rawPath.trim())
        try {
          const info = await stat(candidate)
          if (info.isFile()) path = candidate
        } catch {
          path = null
        }
      }
      if (!path && id) path = media.get(id) || null
      if (!path && rootPath && relativePath) {
        path = await resolveExistingWithinRoot(rootPath, relativePath)
        if (path && id) media.set(id, path)
      }
      if (!path) {
        return send(res, 404, {
          ok: false,
          error: 'Dosya yolu bulunamadı. Sürücü bağlı mı?',
        })
      }
      try {
        await access(path)
      } catch {
        return send(res, 404, { ok: false, error: 'Dosya diskte yok.' })
      }
      const prefer = String(player || 'system').toLowerCase()
      if (prefer === 'vlc') {
        const vlcCandidates = [
          process.env.VLC_PATH,
          'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
          'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
        ].filter(Boolean)
        let vlc = null
        for (const c of vlcCandidates) {
          try {
            await access(c)
            vlc = c
            break
          } catch {
            /* */
          }
        }
        if (!vlc) {
          return send(res, 500, { ok: false, error: 'VLC bulunamadı.' })
        }
        spawn(vlc, ['--started-from-file', path], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        }).unref()
        return send(res, 200, { ok: true, engine: 'vlc', path })
      }
      if (prefer === 'wmplayer' || prefer === 'wmp' || prefer === 'mediaplayer') {
        const wmpCandidates = [
          'C:\\Program Files\\Windows Media Player\\wmplayer.exe',
          'C:\\Program Files (x86)\\Windows Media Player\\wmplayer.exe',
        ]
        let wmp = null
        for (const c of wmpCandidates) {
          try {
            await access(c)
            wmp = c
            break
          } catch {
            /* */
          }
        }
        if (wmp) {
          spawn(wmp, [path], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          }).unref()
          return send(res, 200, { ok: true, engine: 'wmplayer', path })
        }
      }
      // Varsayılan: Windows dosya ilişkilendirmesi (Films & TV / Photos / …)
      spawn('cmd.exe', ['/c', 'start', '', path], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref()
      return send(res, 200, { ok: true, engine: 'system', path })
    }
    if (req.method === 'GET' && url.pathname === '/api/players') {
      let vlc = false
      let wmplayer = false
      for (const c of [
        process.env.VLC_PATH,
        'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
        'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
      ].filter(Boolean)) {
        try {
          await access(c)
          vlc = true
          break
        } catch {
          /* */
        }
      }
      for (const c of [
        'C:\\Program Files\\Windows Media Player\\wmplayer.exe',
        'C:\\Program Files (x86)\\Windows Media Player\\wmplayer.exe',
      ]) {
        try {
          await access(c)
          wmplayer = true
          break
        } catch {
          /* */
        }
      }
      return send(res, 200, { vlc, wmplayer, system: true })
    }
    if (req.method === 'POST' && url.pathname === '/api/reveal') {
      const { id, path: rawPath, rootPath, relativePath } = await readBody(req)
      let path = null
      let missingOnDisk = false

      // Önce oynatma / resolve ile bilinen gerçek yol (yanlış client path Belgeler'e düşmesin)
      if (id) path = media.get(id) || null

      if (!path && rootPath && relativePath) {
        path = await resolveExistingWithinRoot(rootPath, relativePath)
        if (path && id) media.set(id, path)
      }

      // Client'ın verdiği yol yalnızca diskte varsa
      if (!path && typeof rawPath === 'string' && rawPath.trim()) {
        const candidate = normalizeRevealPath(rawPath)
        if (candidate) {
          try {
            const info = await stat(candidate)
            if (info.isFile() || info.isDirectory()) path = candidate
          } catch {
            /* aday yok — aşağıda üst klasöre düş */
          }
        }
      }

      // Dosya yoksa üst klasörü aç (varsa); yoksa Explorer Belgeler'e düşmesin
      let openTarget = path
      let isFile = false
      if (path) {
        try {
          const info = await stat(path)
          isFile = info.isFile()
          openTarget = path
        } catch {
          missingOnDisk = true
          const parent = dirname(path)
          try {
            const parentInfo = await stat(parent)
            if (parentInfo.isDirectory()) {
              openTarget = parent
              isFile = false
            } else {
              path = null
            }
          } catch {
            path = null
            openTarget = null
          }
        }
      }

      // Son çare: yanlış client rawPath üst klasörünü AÇMA —
      // var olmayan /select yolu Windows’ta Belgeler’e düşer.
      // Yalnızca diskte doğrulanmış openTarget ile devam.

      if (!openTarget) {
        return send(
          res,
          404,
          {
            error:
              'Klasör yolu bulunamadı. Kaynağı “+ Sürücü ekle” veya klasör seçici ile ekleyin (FSA tek başına Explorer açamaz).',
          },
          req,
        )
      }

      // Açmadan önce bir kez daha doğrula
      try {
        const info = await stat(openTarget)
        isFile = info.isFile()
        if (!isFile && !info.isDirectory()) {
          return send(res, 404, { error: `Geçersiz yol: ${openTarget}` }, req)
        }
      } catch {
        return send(
          res,
          404,
          { error: `Dosya/klasör diskte yok: ${openTarget}` },
          req,
        )
      }

      try {
        await openPathInExplorer(openTarget, isFile)
      } catch (err) {
        return send(
          res,
          500,
          {
            error:
              err instanceof Error
                ? `Explorer açılamadı: ${err.message}`
                : 'Explorer açılamadı.',
            path: path || openTarget,
          },
          req,
        )
      }
      return send(
        res,
        200,
        {
          ok: true,
          path: path || openTarget,
          folder: isFile ? dirname(openTarget) : openTarget,
          selected: isFile,
          missingOnDisk,
        },
        req,
      )
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
      const { id, rootPath, relativePath, path: rawPath } = await readBody(req)
      try {
        const result = await chromeCompatibleFromPath(id, rootPath, relativePath, rawPath)
        if (result.cached) return send(res, 200, { url: result.url, key: result.key, cached: true })
        return send(res, 202, { jobId: result.jobId, key: result.key })
      } catch (error) {
        return send(res, 400, {
          error: error instanceof Error ? error.message : 'Transcode failed.',
        })
      }
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
      // pathname %2F'yi / yapabilir; ham req.url kullan
      const rawPath = String(req.url || '').split('?')[0]
      const fileName = decodeURIComponent(rawPath.slice('/api/transcoded/'.length))
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
      // Önemli: URL.pathname %2F → / çevirir; id içindeki klasör ayracı kaybolur.
      // Ham req.url ile id'yi çöz (sourceId|DCIM/foo.mp4|size|mtime).
      const rawPath = String(req.url || '').split('?')[0]
      const id = decodeURIComponent(rawPath.slice('/api/media/'.length))
      const path = media.get(id)
      if (!path) return send(res, 404, { error: 'Medya bulunamadı.' })
      await streamMedia(req, res, path)
      return
    }
    return send(res, 404, { error: 'Bulunamadı.' })
  } catch (error) { return send(res, 500, { error: error instanceof Error ? error.message : 'Tarama hatası.' }) }
}).listen(Number(process.env.MEDIAATLAS_API_PORT || 5174), '127.0.0.1', () => {
  const port = Number(process.env.MEDIAATLAS_API_PORT || 5174)
  console.log(`MedyaAtlas yerel servis: ${port}`)
  void ensureMedyaAtlasDirs().then((dirs) => {
    console.log(`[api] Veri klasörü: ${dirs.root}`)
  })
  void locationWorkerAvailable().then(async (ok) => {
    const sibling = await siblingExtractorAvailable()
    console.log(
      ok
        ? `[api] Konum Bulucu hazır${sibling ? ' (kardeş location_extractor)' : ' (yedek kopya — kardeş proje önerilir)'}`
        : '[api] Konum Bulucu worker açılamadı — tarama çalışmaz',
    )
  })
}).on('error', (err) => {
  console.error('[api] listen hatası:', err)
  // Gözcü yeniden başlatsın
  process.exit(1)
})
