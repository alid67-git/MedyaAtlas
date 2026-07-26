/** Windows/Chrome'da gerçek klasör seçici (File System Access API). */

type DirHandle = FileSystemDirectoryHandle & {
  values: () => AsyncIterable<FileSystemHandle>
  queryPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (opts: {
    mode: 'read' | 'readwrite'
  }) => Promise<PermissionState>
}

async function collectFromDirectory(
  dir: DirHandle,
  pathPrefix: string,
  out: File[],
  acceptName?: (name: string) => boolean,
): Promise<void> {
  for await (const entry of dir.values()) {
    if (entry.kind === 'file') {
      if (acceptName && !acceptName(entry.name)) continue
      const file = await (entry as FileSystemFileHandle).getFile()
      const relativePath = pathPrefix
        ? `${pathPrefix}/${entry.name}`
        : entry.name
      Object.defineProperty(file, 'webkitRelativePath', {
        value: relativePath,
        configurable: true,
      })
      out.push(file)
    } else if (entry.kind === 'directory') {
      const next = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name
      await collectFromDirectory(entry as DirHandle, next, out, acceptName)
    }
  }
}

export function canPickFolder(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/** Klasör seçtirir ve handle döner. Destek yoksa null, iptal edilirse 'cancelled'. */
export async function pickFolderHandle(): Promise<
  FileSystemDirectoryHandle | null | 'cancelled'
> {
  if (!canPickFolder()) return null
  try {
    return await window.showDirectoryPicker({ mode: 'read' })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    throw e
  }
}

/** Handle içindeki tüm dosyaları özyinelemeli okur. */
export async function readFilesFromHandle(
  handle: FileSystemDirectoryHandle,
  acceptName?: (name: string) => boolean,
): Promise<File[]> {
  const files: File[] = []
  await collectFromDirectory(handle as DirHandle, '', files, acceptName)
  return files
}

/** Yalnızca klasörün kendisindeki dosyalar (alt klasörlere inmez). */
export async function readDirectFilesFromHandle(
  handle: FileSystemDirectoryHandle,
  acceptName?: (name: string) => boolean,
): Promise<File[]> {
  const out: File[] = []
  for await (const entry of (handle as DirHandle).values()) {
    if (entry.kind !== 'file') continue
    if (acceptName && !acceptName(entry.name)) continue
    const file = await (entry as FileSystemFileHandle).getFile()
    Object.defineProperty(file, 'webkitRelativePath', {
      value: entry.name,
      configurable: true,
    })
    out.push(file)
  }
  return out
}

const SKIP_DIR_NAMES = new Set([
  '$recycle.bin',
  'system volume information',
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  'recovery',
  '.trash',
  '.trashes',
  '.git',
  'node_modules',
  '__macosx',
  'found.000',
])

export interface DiscoveredMediaFolder {
  /** Kök göreli yol; kökün kendisi için boş string. */
  subPath: string
  handle: FileSystemDirectoryHandle
  /** Bu klasörde (doğrudan) bulunan medya dosyası sayısı. */
  directCount: number
}

export const DISCOVER_MAX_FOLDERS = 50_000

/**
 * Sürücü/klasör ağacında doğrudan medya içeren klasörleri bulur.
 * GPS okumaz — sadece ada göre hızlı keşif; alt dallar için kullanılır.
 *
 * BFS kullanır: 5TB gibi büyük disklerde derinlik-öncelikli tarama bir
 * dalda limit doldurup diğer üst klasörleri kaçırıyordu.
 */
export async function discoverMediaFolders(
  root: FileSystemDirectoryHandle,
  acceptName: (name: string) => boolean,
  options?: { maxFolders?: number; signal?: AbortSignal },
): Promise<DiscoveredMediaFolder[]> {
  const maxFolders = options?.maxFolders ?? DISCOVER_MAX_FOLDERS
  const signal = options?.signal
  const found: DiscoveredMediaFolder[] = []
  const queue: Array<{ dir: DirHandle; pathPrefix: string }> = [
    { dir: root as DirHandle, pathPrefix: '' },
  ]

  while (queue.length > 0) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (found.length >= maxFolders) break

    const { dir, pathPrefix } = queue.shift()!
    let directCount = 0
    const subdirs: Array<{ name: string; handle: DirHandle }> = []

    for await (const entry of dir.values()) {
      if (entry.kind === 'file') {
        if (acceptName(entry.name)) directCount += 1
      } else if (entry.kind === 'directory') {
        if (SKIP_DIR_NAMES.has(entry.name.toLowerCase())) continue
        if (entry.name.startsWith('.')) continue
        subdirs.push({ name: entry.name, handle: entry as DirHandle })
      }
    }

    if (directCount > 0) {
      found.push({ subPath: pathPrefix, handle: dir, directCount })
    }

    for (const sub of subdirs) {
      const next = pathPrefix ? `${pathPrefix}/${sub.name}` : sub.name
      queue.push({ dir: sub.handle, pathPrefix: next })
    }
  }

  return found
}

/** Kaydedilmiş handle için okuma izni sağlar (gerekirse ister). */
export async function ensureReadPermission(
  handle: FileSystemDirectoryHandle,
  prompt = false,
): Promise<boolean> {
  const h = handle as DirHandle
  const opts = { mode: 'read' as const }
  if (h.queryPermission) {
    const state = await h.queryPermission(opts)
    if (state === 'granted') return true
    if (!prompt) return false
  }
  if (prompt && h.requestPermission) {
    const state = await h.requestPermission(opts)
    return state === 'granted'
  }
  return false
}

/**
 * Klasör seçer ve içindeki tüm dosyaları döner.
 * Destek yoksa null; kullanıcı iptal ederse [].
 */
export async function pickFolderFiles(): Promise<File[] | null> {
  const handle = await pickFolderHandle()
  if (handle === null) return null
  if (handle === 'cancelled') return []
  return readFilesFromHandle(handle)
}

/** Kök handle'dan göreli yola giderek dosyayı çözer. */
export async function resolveFileFromHandle(
  root: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<File | null> {
  try {
    const parts = relativePath.split('/').filter(Boolean)
    if (parts.length === 0) return null
    const fileName = parts.pop()!
    let dir = root as DirHandle
    for (const part of parts) {
      dir = (await dir.getDirectoryHandle(part)) as DirHandle
    }
    const fileHandle = await dir.getFileHandle(fileName)
    return await fileHandle.getFile()
  } catch {
    return null
  }
}

/**
 * Kaynak şu an gerçekten erişilebilir mi?
 * İzin verilmiş VE disk takılı (kök okunabiliyor) ise true.
 */
export async function isSourceAvailable(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const granted = await ensureReadPermission(handle, false)
  if (!granted) return false
  try {
    const iterator = (handle as DirHandle).values()[Symbol.asyncIterator]()
    await iterator.next()
    return true
  } catch {
    return false
  }
}

/** İki handle aynı klasörü mü gösteriyor? */
export async function isSameFolder(
  a: FileSystemDirectoryHandle,
  b: FileSystemDirectoryHandle,
): Promise<boolean> {
  try {
    const withSame = a as FileSystemDirectoryHandle & {
      isSameEntry?: (other: FileSystemHandle) => Promise<boolean>
    }
    if (withSame.isSameEntry) return await withSame.isSameEntry(b)
  } catch {
    // düş
  }
  // isSameEntry yoksa emin olamayız; yanlış birleştirme riskine girme
  return false
}

/**
 * `child`, `parent` klasörünün içindeyse göreli yolu döner; değilse null.
 * Aynı klasörse boş dizi yerine null döner (gerçek alt klasör aranır).
 */
export async function relativePathIfDescendant(
  parent: FileSystemDirectoryHandle,
  child: FileSystemDirectoryHandle,
): Promise<string[] | null> {
  try {
    const rel = await parent.resolve(child)
    if (rel && rel.length > 0) return rel
  } catch {
    // düş
  }
  return null
}
