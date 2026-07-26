import type { LibraryItem, SourceRecord } from './cache'

export type DiskSource = Omit<SourceRecord, 'handle'>

export interface DiskLibraryState {
  sources: DiskSource[]
  items: LibraryItem[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeSources(raw: unknown): DiskSource[] {
  if (!Array.isArray(raw)) return []
  const out: DiskSource[] = []
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue
    out.push({
      id: entry.id,
      label: typeof entry.label === 'string' ? entry.label : entry.id,
      addedAt: typeof entry.addedAt === 'number' ? entry.addedAt : Date.now(),
      localPath: typeof entry.localPath === 'string' ? entry.localPath : undefined,
      parentId: typeof entry.parentId === 'string' ? entry.parentId : undefined,
      subPath: typeof entry.subPath === 'string' ? entry.subPath : undefined,
      isAnchor: entry.isAnchor === true,
      directOnly: entry.directOnly === true,
    })
  }
  return out
}

function normalizeItems(raw: unknown): LibraryItem[] {
  if (!Array.isArray(raw)) return []
  const out: LibraryItem[] = []
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue
    if (typeof entry.sourceId !== 'string' || typeof entry.name !== 'string') continue
    if (typeof entry.latitude !== 'number' || typeof entry.longitude !== 'number') continue
    out.push({
      id: entry.id,
      sourceId: entry.sourceId,
      relativePath:
        typeof entry.relativePath === 'string' ? entry.relativePath : entry.name,
      name: entry.name,
      kind: (entry.kind as LibraryItem['kind']) || 'photo',
      latitude: entry.latitude,
      longitude: entry.longitude,
      takenAt: typeof entry.takenAt === 'number' ? entry.takenAt : undefined,
      width: typeof entry.width === 'number' ? entry.width : undefined,
      height: typeof entry.height === 'number' ? entry.height : undefined,
      locationMissing: entry.locationMissing === true,
    })
  }
  return out
}

/** Masaüstü API disk yedeği — IndexedDB silinse bile sürücüler kalır. */
export async function fetchDiskLibraryState(): Promise<DiskLibraryState | null> {
  try {
    const response = await fetch('/api/library-state')
    if (!response.ok) return null
    const data: unknown = await response.json()
    if (!isRecord(data)) return null
    return {
      sources: normalizeSources(data.sources),
      items: normalizeItems(data.items),
    }
  } catch {
    return null
  }
}

export async function pushDiskLibraryState(
  sources: DiskSource[],
  items: LibraryItem[],
): Promise<void> {
  try {
    await fetch('/api/library-state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources, items }),
    })
  } catch {
    /* API yoksa sessiz */
  }
}
