/**
 * Yerel API gözcüsü — çökerse birkaç saniye içinde yeniden başlatır.
 * Kullanım: node scripts/api-watch.mjs
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'server', 'index.mjs')
const restartMs = 2000

let child = null
let stopping = false

function start() {
  if (stopping) return
  console.log(`[api-watch] başlatılıyor: ${entry}`)
  child = spawn(process.execPath, [entry], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    windowsHide: false,
  })
  child.on('exit', (code, signal) => {
    child = null
    if (stopping) return
    console.error(
      `[api-watch] API kapandı (code=${code ?? '?'} signal=${signal ?? '-'}). ${restartMs / 1000}s sonra yeniden…`,
    )
    setTimeout(start, restartMs)
  })
}

function shutdown() {
  stopping = true
  if (child && !child.killed) {
    try {
      child.kill()
    } catch {
      /* */
    }
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

start()
