import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'

/** Lon genelde lat’tan 8–16 bayt sonra (protobuf alan etiketi). */
const PAIR_GAPS = [8, 9, 10, 12, 16]

function isSaneCoord(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false
  // Her iki eksende de 0 yakını = protobuf gürültüsü / null island
  if (Math.abs(lat) < 0.5 || Math.abs(lon) < 0.5) return false
  return true
}

/**
 * djmd protobuf içinde lat/lon double çiftlerini bul; en sık tekrarlayanı seç.
 * Tek rastgele double çifti (yanlış kıta) yerine konsensus.
 */
export function gpsFromDjmdBuffer(buf) {
  if (!buf?.length || buf.length < 24) return null

  /** @type {Map<string, { latitude: number, longitude: number, count: number }>} */
  const clusters = new Map()

  for (let i = 0; i <= buf.length - 16; i++) {
    const lat = buf.readDoubleLE(i)
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lat) < 0.5) continue

    for (const gap of PAIR_GAPS) {
      if (i + gap + 8 > buf.length) continue
      const lon = buf.readDoubleLE(i + gap)
      if (!isSaneCoord(lat, lon)) continue
      if (Math.abs(lat - lon) < 1e-6) continue

      const key = `${lat.toFixed(4)},${lon.toFixed(4)}`
      const prev = clusters.get(key)
      if (prev) prev.count += 1
      else clusters.set(key, { latitude: lat, longitude: lon, count: 1 })
    }
  }

  let best = null
  for (const c of clusters.values()) {
    if (!best || c.count > best.count) best = c
    else if (best && c.count === best.count) {
      // Eşitlikte daha “gerçek” görünen (daha büyük |lon|) tercih
      if (Math.abs(c.longitude) > Math.abs(best.longitude)) best = c
    }
  }
  if (!best || best.count < 2) return null
  return { latitude: best.latitude, longitude: best.longitude }
}

let djiActive = 0
const djiWait = []
const DJI_MAX = 2

async function acquireDji() {
  if (djiActive >= DJI_MAX) {
    await new Promise((resolve) => djiWait.push(resolve))
  }
  djiActive += 1
}

function releaseDji() {
  djiActive = Math.max(0, djiActive - 1)
  djiWait.shift()?.()
}

/**
 * DJI Mini 5 Pro / yeni DJI: GPS, MP4 içindeki djmd stream’inde.
 * ExifTool tüm telemetriyi okuyup dakikalar sürer; ffmpeg ile ilk ~1.5 sn + konsensus.
 */
export async function readDjiDjmdGps(path, timeoutMs = 20000) {
  if (!ffmpegPath) return null
  await acquireDji()
  try {
    return await new Promise((resolve) => {
      const child = spawn(
        ffmpegPath,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          path,
          '-map',
          '0:d:0',
          '-c',
          'copy',
          '-t',
          '1.5',
          '-f',
          'data',
          'pipe:1',
        ],
        { windowsHide: true },
      )

      const chunks = []
      let total = 0
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          child.kill()
        } catch {
          /* */
        }
        resolve(value)
      }

      const timer = setTimeout(() => finish(null), timeoutMs)

      child.stdout.on('data', (chunk) => {
        chunks.push(chunk)
        total += chunk.length
        // Yeterli telemetri birikince konsensus al (çok erken = gürültü)
        if (total >= 48 * 1024) {
          const gps = gpsFromDjmdBuffer(Buffer.concat(chunks))
          if (gps) finish(gps)
        }
        if (total > 768 * 1024) {
          finish(gpsFromDjmdBuffer(Buffer.concat(chunks)))
        }
      })

      child.on('close', () => {
        finish(gpsFromDjmdBuffer(Buffer.concat(chunks)))
      })
      child.on('error', () => finish(null))
    })
  } finally {
    releaseDji()
  }
}
