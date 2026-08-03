import { normalizeSearchText } from './mediaSearch'

export interface PlaceHit {
  id: string
  label: string
  latitude: number
  longitude: number
  /** Nominatim bounding box: [south, north, west, east] */
  bbox?: [number, number, number, number]
}

interface NominatimResult {
  place_id: number
  display_name: string
  lat: string
  lon: string
  boundingbox?: [string, string, string, string]
}

/** OpenStreetMap Nominatim — yer adı → koordinat (1 req/sn nazik kullanım). */
export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<PlaceHit[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const url =
    'https://nominatim.openstreetmap.org/search?' +
    new URLSearchParams({
      q,
      format: 'json',
      limit: '6',
      addressdetails: '0',
    })

  const res = await fetch(url, {
    signal,
    headers: {
      Accept: 'application/json',
    },
  })
  if (!res.ok) return []
  const data = (await res.json()) as NominatimResult[]
  const hits: PlaceHit[] = []
  for (const row of data) {
    const latitude = Number(row.lat)
    const longitude = Number(row.lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue
    let bbox: PlaceHit['bbox']
    if (row.boundingbox?.length === 4) {
      const south = Number(row.boundingbox[0])
      const north = Number(row.boundingbox[1])
      const west = Number(row.boundingbox[2])
      const east = Number(row.boundingbox[3])
      if (
        Number.isFinite(south) &&
        Number.isFinite(north) &&
        Number.isFinite(west) &&
        Number.isFinite(east)
      ) {
        bbox = [south, north, west, east]
      }
    }
    hits.push({
      id: `place-${row.place_id}`,
      label: row.display_name,
      latitude,
      longitude,
      bbox,
    })
  }
  return hits
}

/** Yer sonuçlarını yerel metin skoruyla sırala (normalize). */
export function rankPlaces(hits: PlaceHit[], query: string): PlaceHit[] {
  const needle = normalizeSearchText(query)
  if (!needle) return hits
  return [...hits].sort((a, b) => {
    const an = normalizeSearchText(a.label)
    const bn = normalizeSearchText(b.label)
    const as = an.startsWith(needle) ? 0 : an.includes(needle) ? 1 : 2
    const bs = bn.startsWith(needle) ? 0 : bn.includes(needle) ? 1 : 2
    return as - bs || a.label.length - b.label.length
  })
}
