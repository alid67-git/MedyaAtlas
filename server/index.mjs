import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, relative, resolve } from 'node:path'
import exifr from 'exifr'

const media = new Map()
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
    const bytes = await readFile(path), part = 256 * 1024
    const head = bytes.subarray(0, part).toString('latin1')
    return gpsFromText(head) ?? gpsFromText(bytes.subarray(Math.max(part, bytes.length - part)).toString('latin1'))
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

async function scan(root, sourceId) {
  root = resolve(root)
  const files = []; await walk(root, files)
  const items = []; let next = 0
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, async () => {
    while (next < files.length) {
      const path = files[next++], kind = kindFor(basename(path)), point = await readGps(path, kind)
      if (!point) continue
      const info = await stat(path), rel = relative(root, path).replaceAll('\\', '/')
      const id = `${sourceId}|${rel}|${info.size}|${info.mtimeMs}`
      media.set(id, path)
      items.push({ id, name: basename(path), relativePath: rel, sourceId, kind, available: true, ...point, takenAt: point.takenAt ? new Date(point.takenAt).toISOString() : new Date(info.mtimeMs).toISOString(), url: `/api/media/${encodeURIComponent(id)}` })
    }
  }))
  return { items, mediaCount: files.length }
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
      return send(res, 200, await scan(path, sourceId))
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/media/')) {
      const path = media.get(decodeURIComponent(url.pathname.slice(11)))
      if (!path) return send(res, 404, { error: 'Medya bulunamadı.' })
      createReadStream(path).pipe(res); return
    }
    return send(res, 404, { error: 'Bulunamadı.' })
  } catch (error) { return send(res, 500, { error: error instanceof Error ? error.message : 'Tarama hatası.' }) }
}).listen(5174, '127.0.0.1', () => console.log('MedyaAtlas yerel servis: 5174'))
