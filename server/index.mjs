import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import exifr from 'exifr'

const media = new Map()
const jobs = new Map()
const photoExt = new Set('jpg jpeg png webp heic heif tif tiff dng gpr arw cr2 nef orf raf rw2'.split(' '))
const videoExt = new Set('mp4 mov m4v avi mkv webm 360 insv ts mts m2ts'.split(' '))
const skipDirs = new Set(['$recycle.bin', 'system volume information', 'windows', 'program files', 'programdata', '.git', 'node_modules'])

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

async function readGps(path, kind) {
  try {
    if (kind === 'photo') {
      const tags = await exifr.parse(await readFile(path), { gps: true, exif: true, tiff: true })
      const point = gps(tags?.latitude, tags?.longitude)
      return point ? { ...point, takenAt: tags?.DateTimeOriginal ?? tags?.CreateDate } : null
    }
    const info = await stat(path), part = 256 * 1024
    const file = await open(path, 'r')
    try {
      const headBytes = Math.min(part, info.size)
      const headBuffer = Buffer.alloc(headBytes)
      await file.read(headBuffer, 0, headBytes, 0)
      const fromHead = gpsFromText(headBuffer.toString('latin1'))
      if (fromHead || info.size <= part) return fromHead
      const tailBytes = Math.min(part, info.size - headBytes)
      const tailBuffer = Buffer.alloc(tailBytes)
      await file.read(tailBuffer, 0, tailBytes, info.size - tailBytes)
      return gpsFromText(tailBuffer.toString('latin1'))
    } finally {
      await file.close()
    }
  } catch { return null }
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
  job.total = files.length
  job.phase = 'scanning'
  let next = 0
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, async () => {
    while (next < files.length) {
      const path = files[next++], kind = kindFor(basename(path))
      const point = await readGps(path, kind)
      job.processed += 1
      if (!point) continue
      const info = await stat(path), rel = relative(root, path).replaceAll('\\', '/')
      const id = `${sourceId}|${rel}|${info.size}|${info.mtimeMs}`
      media.set(id, path)
      job.items.push({ id, name: basename(path), relativePath: rel, sourceId, kind, available: true, ...point, takenAt: point.takenAt ? new Date(point.takenAt).toISOString() : new Date(info.mtimeMs).toISOString(), url: `/api/media/${encodeURIComponent(id)}` })
    }
  }))
  job.phase = 'done'
  job.done = true
}

function send(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': 'http://localhost:5173' }); res.end(JSON.stringify(value)) }
async function readBody(req) { const chunks = []; for await (const c of req) chunks.push(c); return JSON.parse(Buffer.concat(chunks).toString()) }

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true })
    if (req.method === 'POST' && url.pathname === '/api/scan') {
      const { path, sourceId } = await readBody(req)
      if (!path || !sourceId) return send(res, 400, { error: 'Klasör yolu gerekli.' })
      const jobId = `${sourceId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const job = { phase: 'discovering', total: 0, processed: 0, items: [], done: false, error: null }
      jobs.set(jobId, job)
      scan(path, sourceId, job).catch((error) => {
        job.error = error instanceof Error ? error.message : 'Scan failed.'
        job.done = true
        job.phase = 'error'
      })
      return send(res, 202, { jobId })
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/scan/')) {
      const job = jobs.get(decodeURIComponent(url.pathname.slice(10)))
      if (!job) return send(res, 404, { error: 'Scan job not found.' })
      const after = Math.max(0, Number(url.searchParams.get('after') ?? '0') || 0)
      return send(res, 200, {
        phase: job.phase,
        total: job.total,
        processed: job.processed,
        items: job.items.slice(after),
        itemCount: job.items.length,
        done: job.done,
        error: job.error,
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
    if (req.method === 'GET' && url.pathname.startsWith('/api/media/')) {
      const path = media.get(decodeURIComponent(url.pathname.slice(11)))
      if (!path) return send(res, 404, { error: 'Medya bulunamadı.' })
      await streamMedia(req, res, path); return
    }
    return send(res, 404, { error: 'Bulunamadı.' })
  } catch (error) { return send(res, 500, { error: error instanceof Error ? error.message : 'Tarama hatası.' }) }
}).listen(5174, '127.0.0.1', () => console.log('MedyaAtlas yerel servis: 5174'))
