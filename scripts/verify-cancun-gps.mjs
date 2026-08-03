/**
 * Tüm E: GoPro + Aralık 2025 DJI içinde Cancun kutusu ara; Tayland örnekleri doğrula.
 */
import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import {
  extractWithLocationWorker,
  flushLocationCache,
  listMediaFilesWithWorker,
  locationWorkerAvailable,
} from '../server/locationWorker.mjs'

const execFileAsync = promisify(execFile)
const exiftool =
  String.raw`C:\google drive\Ali Dinçer Projeler\video daki konum neresi\tools\ExifTool.exe`

function nearCancun(lat, lon) {
  return lat > 20 && lat < 22.5 && lon < -86 && lon > -88.5
}
function nearThailand(lat, lon) {
  return lat > 5 && lat < 21 && lon > 97 && lon < 106
}

await locationWorkerAvailable()

const roots = [
  String.raw`E:\2.7GB yedek\GoPro görüntüleri`,
  String.raw`E:\2.7GB yedek\DJI Drone görüntüleri\2025`,
  String.raw`E:\gopro'dan yuklenenler. 28.8.2025`,
]

const cancun = []
const thaiHits = []
let checked = 0

for (const root of roots) {
  let files = []
  try {
    files = await listMediaFilesWithWorker(root, { recursive: true })
  } catch (e) {
    console.error('list fail', root, e.message)
    continue
  }
  console.log('root', root, 'files', files.length)
  for (const path of files) {
    checked += 1
    if (checked % 100 === 0) process.stderr.write(`checked ${checked}\n`)
    const r = await extractWithLocationWorker(path, { mode: 'fast' })
    if (!r.point) continue
    const { latitude: lat, longitude: lon } = r.point
    if (nearCancun(lat, lon)) {
      cancun.push({
        lat: +lat.toFixed(5),
        lon: +lon.toFixed(5),
        file: basename(path),
        path,
        source: r.source,
      })
    } else if (nearThailand(lat, lon) && thaiHits.length < 8) {
      thaiHits.push({
        lat: +lat.toFixed(5),
        lon: +lon.toFixed(5),
        file: basename(path),
        source: r.source,
      })
    }
  }
}

await flushLocationCache()
console.log(JSON.stringify({ checked, cancunCount: cancun.length, thaiSample: thaiHits.length }, null, 2))
console.log('CANCUN HITS', JSON.stringify(cancun, null, 2))
console.log('THAI OK SAMPLE', JSON.stringify(thaiHits, null, 2))

const cross = cancun[0] || null
// Ayrıca bilinen Tayland dosyasını ExifTool ile doğrula
const thaiFile =
  thaiHits[0] &&
  (
    await listMediaFilesWithWorker(String.raw`E:\2.7GB yedek\GoPro görüntüleri`, {
      recursive: true,
    })
  ).find((p) => p.endsWith(thaiHits[0].file))

for (const target of [cross?.path, thaiFile].filter(Boolean)) {
  try {
    const { stdout } = await execFileAsync(
      exiftool,
      [
        '-n',
        '-ee',
        '-GPSLatitude',
        '-GPSLongitude',
        '-CreateDate',
        '-TrackCreateDate',
        '-api',
        'LargeFileSupport=1',
        target,
      ],
      { windowsHide: true, timeout: 180000, maxBuffer: 30 * 1024 * 1024 },
    )
    console.log('EXIFTOOL', target)
    console.log(stdout.trim().slice(0, 600))
  } catch (e) {
    console.error('exiftool err', target, e.message?.slice(0, 200))
  }
}

process.exit(0)
