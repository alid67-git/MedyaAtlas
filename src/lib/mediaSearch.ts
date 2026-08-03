/**
 * Medya metin araması — ucuzbilet places aramasındaki gibi:
 * Unicode normalize, aksan kırpma, hızlı substring eşleşme.
 */

export function normalizeSearchText(text: string): string {
  const lowered = text.trim().toLowerCase()
  const normalized = lowered.normalize('NFKD')
  return normalized.replace(/\p{M}/gu, '')
}

/** Dosya adı + göreli yol (+ isteğe bağlı kaynak etiketi) haystack. */
export function mediaSearchHaystack(
  name: string,
  relativePath?: string,
  sourceLabel?: string,
): string {
  return normalizeSearchText(
    [name, relativePath ?? '', sourceLabel ?? ''].filter(Boolean).join(' '),
  )
}

/**
 * Needle boşsa true.
 * Eşleşme: tam / başlangıç / içerir (ucuzbilet skorunun sade hali).
 */
export function matchesMediaSearch(haystackNorm: string, needleNorm: string): boolean {
  if (!needleNorm) return true
  if (!haystackNorm) return false
  return (
    haystackNorm === needleNorm ||
    haystackNorm.startsWith(needleNorm) ||
    haystackNorm.includes(needleNorm)
  )
}

export function itemMatchesQuery(
  item: { name: string; relativePath?: string },
  query: string,
  sourceLabel?: string,
): boolean {
  const needle = normalizeSearchText(query)
  if (!needle) return true
  return matchesMediaSearch(
    mediaSearchHaystack(item.name, item.relativePath, sourceLabel),
    needle,
  )
}
