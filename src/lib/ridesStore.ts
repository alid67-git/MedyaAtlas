/** Belgelerim\\MedyaAtlas\\rides — yerel API üzerinden ride dosya kopyası / sync. */

import { parseTrackFile, trackFileDisplayName, type MapTrack } from './tracks'

function localApiUrl(path: string): string {
  return path
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk)
    for (let j = 0; j < slice.length; j++) binary += String.fromCharCode(slice[j])
  }
  return btoa(binary)
}

export interface RideDiskEntry {
  fileName: string
  path: string
  size: number
  mtimeMs: number
}

export async function fetchDataDir(): Promise<{
  root: string
  ridesDir: string
} | null> {
  try {
    const res = await fetch(localApiUrl('/api/data-dir'), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      ok?: boolean
      root?: string
      ridesDir?: string
    }
    if (!data.ok || !data.root || !data.ridesDir) return null
    return { root: data.root, ridesDir: data.ridesDir }
  } catch {
    return null
  }
}

export async function listDiskRides(): Promise<RideDiskEntry[]> {
  try {
    const res = await fetch(localApiUrl('/api/rides'), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { ok?: boolean; rides?: RideDiskEntry[] }
    return Array.isArray(data.rides) ? data.rides : []
  } catch {
    return []
  }
}

/** Ride dosyasını Documents\\MedyaAtlas\\rides altına kopyala. */
export async function importRideFileToDisk(
  file: File,
): Promise<{ path: string; fileName: string } | null> {
  try {
    const buf = new Uint8Array(await file.arrayBuffer())
    const res = await fetch(localApiUrl('/api/rides/import'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        contentBase64: bytesToBase64(buf),
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      ok?: boolean
      path?: string
      fileName?: string
    }
    if (!data.ok || !data.path || !data.fileName) return null
    return { path: data.path, fileName: data.fileName }
  } catch {
    return null
  }
}

async function fetchRideAsFile(fileName: string): Promise<File | null> {
  try {
    const res = await fetch(
      localApiUrl(`/api/rides/raw?name=${encodeURIComponent(fileName)}`),
      { cache: 'no-store' },
    )
    if (!res.ok) return null
    const blob = await res.blob()
    return new File([blob], fileName, {
      type: blob.type || 'application/octet-stream',
    })
  } catch {
    return null
  }
}

function trackMatchesDiskName(track: MapTrack, fileName: string): boolean {
  const want = trackFileDisplayName(fileName).toLowerCase()
  if (track.diskPath) {
    const base = track.diskPath.replace(/^.*[/\\]/, '').toLowerCase()
    if (base === want) return true
  }
  return trackFileDisplayName(track.name).toLowerCase() === want
}

/**
 * Diskteki ride dosyalarından IndexedDB’de olmayanları parse edip ekle.
 */
export async function syncRidesFromDisk(
  existing: readonly MapTrack[],
): Promise<MapTrack[]> {
  const listed = await listDiskRides()
  if (listed.length === 0) return []

  const sourceId = `ride-docs-${Date.now()}`
  const added: MapTrack[] = []
  for (const entry of listed) {
    if (existing.some((t) => trackMatchesDiskName(t, entry.fileName))) continue
    if (added.some((t) => trackMatchesDiskName(t, entry.fileName))) continue
    const file = await fetchRideAsFile(entry.fileName)
    if (!file) continue
    const track = await parseTrackFile(file, sourceId)
    if (!track) continue
    added.push({ ...track, diskPath: entry.path })
  }
  return added
}
