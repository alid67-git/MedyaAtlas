export type AppEdition = 'v1' | 'v2'

/** V1 = klasik masaüstü; V2 = web/PWA/telefon. */
export function getAppEdition(): AppEdition {
  const fromDefine =
    typeof __APP_EDITION__ !== 'undefined' ? __APP_EDITION__ : undefined
  if (fromDefine === 'v1' || fromDefine === 'v2') return fromDefine

  if (typeof window !== 'undefined') {
    const q = new URLSearchParams(window.location.search).get('edition')
    if (q === 'v1' || q === 'v2') return q
  }

  const fromEnv = import.meta.env.VITE_MEDIAATLAS_EDITION
  if (fromEnv === 'v1' || fromEnv === 'v2') return fromEnv

  return 'v2'
}

export function isEditionV1(): boolean {
  return getAppEdition() === 'v1'
}

export function isEditionV2(): boolean {
  return getAppEdition() === 'v2'
}

export function editionLabel(edition: AppEdition = getAppEdition()): string {
  return edition === 'v1' ? 'MedyaAtlas V1' : 'MedyaAtlas V2'
}
