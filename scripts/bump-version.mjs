import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(root, 'package.json')
const lockPath = join(root, 'package-lock.json')

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const match = String(pkg.version).match(/^(\d+)\.(\d+)\.(\d+)(.*)$/)
if (!match) {
  console.error(`Sürüm okunamadı: ${pkg.version}`)
  process.exit(1)
}

const next = `${match[1]}.${match[2]}.${Number(match[3]) + 1}${match[4]}`
pkg.version = next
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

try {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  lock.version = next
  if (lock.packages?.['']) lock.packages[''].version = next
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
} catch {
  // package-lock yoksa sorun değil
}

console.log(`Sürüm: ${match[0]} → ${next}`)
