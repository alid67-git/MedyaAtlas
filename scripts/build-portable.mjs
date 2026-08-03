/**
 * MedyaAtlas taşınabilir Windows paketi.
 *
 * Çıktı:
 *   release/MedyaAtlas/          → klasör (exe + sidecar)
 *   release/MedyaAtlas-portable.zip
 *
 * Arkadaşında Node/Python kurulu olması gerekmez.
 */
import { spawn, execFileSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = join(root, 'release')
const outDir = join(releaseDir, 'MedyaAtlas')
const sidecarDir = join(outDir, 'sidecar')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version || '0.0.0'

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`)
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...opts,
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exit ${code}`))
    })
    child.on('error', reject)
  })
}

function whichNode() {
  return process.execPath
}

async function zipFolder(sourceDir, zipPath) {
  // PowerShell Compress-Archive — ekstra bağımlılık yok
  if (existsSync(zipPath)) rmSync(zipPath)
  const ps = `
    Compress-Archive -Path '${sourceDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force
  `
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', ps],
    { stdio: 'inherit' },
  )
}

async function main() {
  console.log(`MedyaAtlas portable build ${version}`)

  // 1) UI build
  await run('npm', ['run', 'build'])

  // 2) PyInstaller
  await run('python', ['-m', 'PyInstaller', '--noconfirm', 'desktop/mediaatlas.spec'])

  const built = join(root, 'dist', 'MedyaAtlas')
  if (!existsSync(join(built, 'MedyaAtlas.exe'))) {
    throw new Error(`PyInstaller çıktısı yok: ${built}`)
  }

  // 3) release klasörü
  mkdirSync(releaseDir, { recursive: true })
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
  cpSync(built, outDir, { recursive: true })

  // 4) Node sidecar
  mkdirSync(join(sidecarDir, 'server'), { recursive: true })
  copyFileSync(whichNode(), join(sidecarDir, 'node.exe'))
  copyFileSync(join(root, 'server', 'index.mjs'), join(sidecarDir, 'server', 'index.mjs'))

  const sidePkg = {
    name: 'mediaatlas-sidecar',
    private: true,
    type: 'module',
    dependencies: {
      exifr: pkg.dependencies.exifr,
      'ffmpeg-static': pkg.dependencies['ffmpeg-static'],
      'gopro-telemetry': pkg.dependencies['gopro-telemetry'],
      'gpmf-extract': pkg.dependencies['gpmf-extract'],
    },
  }
  writeFileSync(join(sidecarDir, 'package.json'), `${JSON.stringify(sidePkg, null, 2)}\n`)
  await run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: sidecarDir,
  })

  // 5) Kullanım notu
  writeFileSync(
    join(outDir, 'OKU.txt'),
    [
      `MedyaAtlas ${version} — taşınabilir paket`,
      '',
      'Kurulum gerekmez. MedyaAtlas.exe dosyasına çift tıkla.',
      '',
      'İlk açılışta Windows Defender / SmartScreen uyarısı çıkabilir:',
      '  "Ek bilgi" → "Yine de çalıştır"',
      '',
      'İnternet: harita karoları için gerekir.',
      'VLC (isteğe bağlı): video önizleme için https://www.videolan.org',
      '',
      'Bu klasörün tamamını USB / zip ile gönder; sadece exe yetmez',
      '(sidecar klasörü GPS taraması için gerekli).',
      '',
    ].join('\r\n'),
  )

  const zipPath = join(releaseDir, `MedyaAtlas-${version}-portable.zip`)
  console.log('Zip oluşturuluyor…')
  await zipFolder(outDir, zipPath)

  console.log('')
  console.log('Hazır:')
  console.log(`  Klasör: ${outDir}`)
  console.log(`  Zip:    ${zipPath}`)
  console.log('Arkadaşına zip dosyasını gönder; açıp MedyaAtlas.exe çalıştırsın.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
