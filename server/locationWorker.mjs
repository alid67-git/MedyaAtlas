/**
 * Kalıcı Python location_extractor işçisi (Konum Bulucu).
 * GPS yalnızca kardeş `video daki konum neresi` / location_extractor üzerinden.
 */
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const workerScript = join(here, '..', 'desktop', 'server', 'location_worker.py')
const siblingExtractor = join(
  here,
  '..',
  '..',
  'video daki konum neresi',
  'location_extractor.py',
)

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let proc = null
/** @type {Promise<boolean> | null} */
let bootPromise = null
let lineBuf = ''
let nextId = 1
/** @type {{ sourceDir?: string, backends?: Record<string, boolean>, sibling?: boolean } | null} */
let workerInfo = null
/** @type {Map<string, { resolve: (v: any) => void, reject: (e: Error) => void, timer: NodeJS.Timeout }>} */
const pending = new Map()

// location_extractor ExifTool -ee tek dosyada ~55s sürebilir.
const REQUEST_TIMEOUT_MS = 70000
const LIST_TIMEOUT_MS = 600000

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

async function resolvePython() {
  const venvCandidates = [
    join(here, '..', 'desktop', '.venv', 'Scripts', 'python.exe'),
    join(here, '..', 'desktop', '.venv', 'bin', 'python'),
    join(
      here,
      '..',
      '..',
      'video daki konum neresi',
      '.venv',
      'Scripts',
      'python.exe',
    ),
  ]
  for (const exe of venvCandidates) {
    try {
      await access(exe)
      const { stdout } = await execFileAsync(exe, ['-c', 'print(1)'], {
        windowsHide: true,
        timeout: 5000,
        encoding: 'utf8',
      })
      if (String(stdout).includes('1')) return { cmd: exe, prefix: [] }
    } catch {
      /* dene sonraki */
    }
  }

  const candidates = ['py', 'python', 'python3']
  for (const cmd of candidates) {
    try {
      const { stdout } = await execFileAsync(
        cmd,
        cmd === 'py' ? ['-3', '-c', 'print(1)'] : ['-c', 'print(1)'],
        { windowsHide: true, timeout: 5000, encoding: 'utf8' },
      )
      if (String(stdout).includes('1')) {
        return cmd === 'py' ? { cmd: 'py', prefix: ['-3'] } : { cmd, prefix: [] }
      }
    } catch {
      /* dene sonraki */
    }
  }
  return null
}

function handleLine(line) {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.ready) {
    workerInfo = {
      sourceDir: typeof msg.source_dir === 'string' ? msg.source_dir : undefined,
      backends:
        msg.backends && typeof msg.backends === 'object' ? msg.backends : undefined,
      sibling: msg.sibling === true,
    }
    console.log(
      '[location-worker] hazır',
      workerInfo.sourceDir || '',
      workerInfo.sibling ? '(kardeş)' : '(yedek kopya)',
      workerInfo.backends ? JSON.stringify(workerInfo.backends) : '',
    )
    return
  }
  const id = msg.id != null ? String(msg.id) : ''
  const wait = pending.get(id)
  if (!wait) return
  clearTimeout(wait.timer)
  pending.delete(id)
  wait.resolve(msg)
}

function onData(chunk) {
  lineBuf += String(chunk)
  let idx
  while ((idx = lineBuf.indexOf('\n')) >= 0) {
    const line = lineBuf.slice(0, idx).trim()
    lineBuf = lineBuf.slice(idx + 1)
    if (line) handleLine(line)
  }
}

function killWorker() {
  if (!proc) return
  try {
    proc.kill()
  } catch {
    /* */
  }
  proc = null
  for (const [id, wait] of pending) {
    clearTimeout(wait.timer)
    wait.reject(new Error('location worker exited'))
    pending.delete(id)
  }
}

async function ensureWorker() {
  if (proc && !proc.killed) return true
  if (bootPromise) return bootPromise
  bootPromise = (async () => {
    try {
      await access(workerScript)
    } catch {
      return false
    }
    const py = await resolvePython()
    if (!py) return false

    return await new Promise((resolve) => {
      let settled = false
      const finish = (ok) => {
        if (settled) return
        settled = true
        resolve(ok)
      }
      const child = spawn(py.cmd, [...py.prefix, workerScript], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      })
      proc = child
      const bootTimer = setTimeout(() => {
        killWorker()
        finish(false)
      }, 12000)
      child.stdout.on('data', (chunk) => {
        onData(chunk)
        if (!settled && /"ready"\s*:\s*true/.test(String(chunk))) {
          clearTimeout(bootTimer)
          finish(true)
        }
      })
      child.stderr.on('data', (chunk) => {
        console.error('[location-worker]', String(chunk).slice(0, 400))
      })
      child.on('error', () => {
        clearTimeout(bootTimer)
        killWorker()
        finish(false)
      })
      child.on('exit', () => {
        clearTimeout(bootTimer)
        if (proc === child) proc = null
        for (const [id, wait] of pending) {
          clearTimeout(wait.timer)
          wait.reject(new Error('location worker exited'))
          pending.delete(id)
        }
        if (!settled) finish(false)
      })
    })
  })().finally(() => {
    bootPromise = null
  })
  return bootPromise
}

/**
 * @param {Record<string, unknown>} body
 * @param {number} [timeoutMs]
 */
async function requestWorker(body, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ok = await ensureWorker()
  if (!ok || !proc?.stdin) throw new Error('location worker unavailable')

  const id = String(nextId++)
  const payload = JSON.stringify({ ...body, id }) + '\n'

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('location worker timeout'))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    try {
      proc.stdin.write(payload)
    } catch (err) {
      clearTimeout(timer)
      pending.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/**
 * @typedef {{
 *   point: { latitude: number, longitude: number } | null,
 *   needsDeep: boolean,
 *   source: string | null,
 *   gpsExtractFailed: boolean,
 * }} LocationWorkerResult
 */

/**
 * @param {string} path
 * @param {{ force?: boolean, mode?: 'fast' | 'deep' | 'full' }} [options]
 * @returns {Promise<LocationWorkerResult>}
 */
export async function extractWithLocationWorker(path, options = {}) {
  const mode = options.mode === 'fast' || options.mode === 'deep' || options.mode === 'full'
    ? options.mode
    : 'full'
  const result = await requestWorker({
    path,
    mode,
    force: Boolean(options.force),
  })

  if (!result || !result.ok) {
    return {
      point: null,
      needsDeep: false,
      source: null,
      gpsExtractFailed: true,
    }
  }
  const point = result.has_location
    ? gps(result.latitude, result.longitude)
    : null
  return {
    point,
    needsDeep: Boolean(result.needs_deep),
    source: typeof result.source === 'string' ? result.source : null,
    gpsExtractFailed: false,
  }
}

/** Disk önbelleğini yaz (tarama/retry bitince bir kez). */
export async function flushLocationCache() {
  try {
    await requestWorker({ op: 'flush' }, 30000)
  } catch (err) {
    console.error('[location-worker] flush:', err)
  }
}

/**
 * Konum Bulucu list_media_files kurallarıyla keşif.
 * @param {string} rootPath
 * @param {{ recursive?: boolean, includeInsv?: boolean }} [options]
 * @returns {Promise<string[]>}
 */
export async function listMediaFilesWithWorker(rootPath, options = {}) {
  const result = await requestWorker(
    {
      op: 'list',
      path: rootPath,
      recursive: options.recursive !== false,
      include_insv: Boolean(options.includeInsv),
    },
    LIST_TIMEOUT_MS,
  )
  if (!result?.ok || !Array.isArray(result.paths)) {
    throw new Error(result?.error || 'Medya listesi alınamadı.')
  }
  return result.paths.map((p) => String(p))
}

export async function locationWorkerAvailable() {
  return ensureWorker()
}

export async function siblingExtractorAvailable() {
  try {
    await access(siblingExtractor)
    return true
  } catch {
    return false
  }
}

export function locationWorkerStatus() {
  return {
    running: Boolean(proc && !proc.killed),
    sourceDir: workerInfo?.sourceDir ?? null,
    backends: workerInfo?.backends ?? null,
    sibling: workerInfo?.sibling === true,
  }
}
