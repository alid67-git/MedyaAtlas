import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { WorldMap, type MapBounds } from './components/WorldMap'
import { MediaGallery, loadGalleryScope, type GalleryScope } from './components/MediaGallery'
import { itemMatchesQuery, matchesMediaSearch, normalizeSearchText } from './lib/mediaSearch'
import { rankPlaces, searchPlaces, type PlaceHit } from './lib/placeSearch'
import { Lightbox } from './components/Lightbox'
import {
  ScanAbortedError,
  detectKind,
  getExtension,
  groupByLocation,
  scanFiles,
} from './lib/media'
import {
  canPickFolder,
  discoverMediaFolders,
  ensureReadPermission,
  isSameFolder,
  isSourceAvailable,
  pickFolderHandle,
  readDirectFilesFromHandle,
  readFilesFromHandle,
  relativePathIfDescendant,
  resolveFileFromHandle,
} from './lib/pickFolder'
import {
  isDesktopRuntime,
  isMobileClient,
  localApiMissingHint,
  probeLocalApi,
} from './lib/runtime'
import { getAppEdition, editionLabel, isEditionV2 } from './lib/edition'
import {
  finalizeTrack,
  formatTrackDateRange,
  isTrackFileName,
  itemsOnTrackDates,
  parseTrackFile,
  trackDateRange,
  type MapTrack,
} from './lib/tracks'
import {
  clearLibrary,
  clearStoredTracks,
  deleteLibraryItems,
  deleteLibraryItemsBySource,
  deleteSource,
  getLastDirHandle,
  getLibraryItems,
  getSources,
  getStoredTracks,
  getThumb,
  putLibraryItems,
  putSource,
  putStoredTracks,
  putThumb,
  type LibraryItem,
  type SourceRecord,
} from './lib/cache'
import { generateThumb } from './lib/thumbs'
import type { MediaItem, MediaKind } from './types'

export interface ThumbInfo {
  url: string
  durationSec?: number
}
import './App.css'

const SESSION_RESUME_KEY = 'medyaatlas-v2-session-resume-dismissed'

function dismissSessionResume(
  setSessionResume: (v: null) => void,
  handledRef: { current: boolean },
) {
  handledRef.current = true
  try {
    sessionStorage.setItem(SESSION_RESUME_KEY, '1')
  } catch {
    /* */
  }
  setSessionResume(null)
}

/** Chrome'un dosya erişim hatalarını anlaşılır Türkçeye çevirir. */
function friendlyError(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : ''
  if (
    msg.includes('underlying filesystem') ||
    msg.includes('NoModificationAllowedError')
  ) {
    return (
      'Disk şu an okunamıyor (çıkarılmış, değişmiş ya da yazma korumalı olabilir). ' +
      'Diski çıkarıp yeniden tak ve tekrar dene; sorun sürerse kaynağı × ile kaldırıp klasörü yeniden ekle.'
    )
  }
  if (msg.includes('not allowed') || msg.includes('NotAllowedError')) {
    return 'Klasör erişim izni verilmedi. "Bağlan" düğmesiyle tekrar izin verebilirsin.'
  }
  if (
    /failed to fetch|networkerror|load failed|fetch.*abort/i.test(msg) ||
    (e instanceof TypeError && /fetch/i.test(msg))
  ) {
    return (
      'Yerel API’ye ulaşılamadı — tarama başlatılamadı. ' +
      'baslat-v2.bat’ı yeniden başlat ve http://127.0.0.1:5183 aç (5173 / GitHub Pages değil).'
    )
  }
  if (/unexpected token|is not valid json|json\.parse/i.test(msg)) {
    return (
      'Tarama API yanıtı geçersiz (yanlış port veya proxy). ' +
      'http://127.0.0.1:5183 kullan; baslat-v2.bat API’yi (5174) açık tutmalı.'
    )
  }
  return msg || fallback
}

async function readJsonResponse<T extends Record<string, unknown>>(
  response: Response,
): Promise<T> {
  const raw = await response.text()
  try {
    return JSON.parse(raw) as T
  } catch {
    const status = response.status
    let hint: string
    if (!raw.trim()) {
      hint =
        status === 0
          ? ' (boş yanıt — CORS/port; same-origin 5183 kullanılmalı)'
          : ` (boş yanıt, HTTP ${status})`
    } else if (raw.trim().startsWith('<') || raw.includes('<!DOCTYPE')) {
      hint = ' (HTML geldi — Vite açık, API kapalı veya yanlış port)'
    } else {
      hint = ` (yanıt: ${raw.slice(0, 80).replace(/\s+/g, ' ')}…)`
    }
    throw new Error(
      'Tarama API yanıtı geçersiz (yanlış port veya proxy)' +
        hint +
        '. http://127.0.0.1:5183 kullan; baslat-v2.bat API’yi (5174) açık tutmalı.',
    )
  }
}

/** Kısa API istekleri — her zaman same-origin (Vite → 5174). Çapraz 5174 CORS/boş yanıt üretir. */
function localApiUrl(path: string): string {
  return path
}

function inBounds(lat: number, lon: number, b: MapBounds): boolean {
  if (lat < b.south || lat > b.north) return false
  const { west, east } = b
  // Normal pencere
  if (west <= east) {
    // worldCopyJump: nokta ±360 kopyasında da olabilir
    return [lon, lon + 360, lon - 360].some((l) => l >= west && l <= east)
  }
  // Tarih çizgisini kesen pencere
  return [lon, lon + 360, lon - 360].some((l) => l >= west || l <= east)
}

/** Aşırı geniş boylam (dünya kopyası) — yerel alan filtresi güvenilir değil. */
function isSaneMapBounds(b: MapBounds): boolean {
  const lonSpan = b.west <= b.east ? b.east - b.west : 360 - (b.west - b.east)
  return lonSpan > 0 && lonSpan < 350
}

function isNullIslandCoordinate(latitude: number, longitude: number): boolean {
  return Math.abs(latitude) < 0.01 && Math.abs(longitude) < 0.01
}

/** Yeniden taramada mtime değişse bile aynı dosya önizlemesi. id: kaynak|yol|boyut|mtime */
function stableThumbKey(item: MediaItem): string {
  const parts = item.id.split('|')
  if (parts.length >= 4) return parts.slice(0, -1).join('|')
  return `${item.sourceId}|${item.relativePath || item.name}`
}

/** Aynı anda en fazla N /api/thumb — tarayıcı + ffmpeg tıkanmasın. */
const THUMB_FETCH_MAX = 4
let thumbFetchActive = 0
const thumbFetchWait: Array<() => void> = []

async function acquireThumbFetch(): Promise<void> {
  if (thumbFetchActive >= THUMB_FETCH_MAX) {
    await new Promise<void>((resolve) => thumbFetchWait.push(resolve))
  }
  thumbFetchActive += 1
}

function releaseThumbFetch(): void {
  thumbFetchActive = Math.max(0, thumbFetchActive - 1)
  thumbFetchWait.shift()?.()
}

interface SourceUi {
  id: string
  label: string
  addedAt: number
  localPath?: string
  parentId?: string
  subPath?: string
  isAnchor?: boolean
  directOnly?: boolean
}

function drivePathFromLabel(label: string | undefined): string | undefined {
  if (!label) return undefined
  // "Elements SE (E:)" veya eski biçim
  const paren = /\(([A-Za-z]):\)/.exec(label)
  if (paren) return `${paren[1].toUpperCase()}:\\`
  // "E: (Elements SE)" — harf başta
  const start = /^([A-Za-z]):(?:\s|$|[\\/])/.exec(label.trim())
  if (start) return `${start[1].toUpperCase()}:\\`
  return undefined
}

/**
 * Çocuk kaynaklarda kayıtlı absolute localPath bayat kalabilir (sürücü harfi değişince).
 * parentId + subPath varsa çapa yolundan türet — offline sanılıp medyanın gizlenmesini önler.
 */
function localPathForSource(source: SourceUi, allSources: readonly SourceUi[]): string | undefined {
  if (source.parentId != null && source.subPath != null) {
    const anchor = allSources.find((item) => item.id === source.parentId)
    const rootSibling = allSources.find(
      (item) =>
        item.parentId === source.parentId && item.subPath === '' && item.localPath,
    )
    const inheritedRoot =
      anchor?.localPath ??
      rootSibling?.localPath ??
      (anchor ? drivePathFromLabel(anchor.label) : undefined)
    if (inheritedRoot) {
      const subPath = source.subPath.replaceAll('/', '\\').replace(/^\\+|\\+$/g, '')
      const root = inheritedRoot.replace(/[\\/]+$/, '')
      return subPath ? `${root}\\${subPath}` : `${root}\\`
    }
  }
  if (source.localPath) return source.localPath
  if (source.isAnchor) return drivePathFromLabel(source.label)
  return undefined
}

/** `F:\\`, `F:/`, `F:` → `F` */
function driveLetterOf(path: string | undefined): string | null {
  if (!path) return null
  const match = /^([A-Za-z]):/.exec(path.trim())
  return match ? match[1].toUpperCase() : null
}

function isDriveRootPath(path: string | undefined): boolean {
  return Boolean(path && /^[A-Za-z]:[\\/]*$/.test(path.trim()))
}

function normalizeWinPath(path: string): string {
  return path.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/** `inner` == `outer` veya `outer` altında. */
function pathEqualsOrInside(inner: string, outer: string): boolean {
  const a = normalizeWinPath(inner)
  const b = normalizeWinPath(outer)
  return a === b || a.startsWith(`${b}\\`)
}

/** Çapa + doğrudan çocuk kaynak id’leri. */
function sourceFamilyIds(
  sourceId: string,
  sources: readonly SourceUi[],
): Set<string> {
  const ids = new Set<string>([sourceId])
  for (const source of sources) {
    if (source.parentId === sourceId) ids.add(source.id)
  }
  return ids
}

/**
 * Medyanın sürücü köküne göreli yolu (orijinal büyük/küçük harf korunur).
 * Karşılaştırma için normalizeRelPath kullan.
 */
function itemPathUnderRoot(
  item: MediaItem,
  sources: readonly SourceUi[],
  rootId: string,
): string | null {
  const source = sources.find((candidate) => candidate.id === item.sourceId)
  if (!source) return null
  const rel = (item.relativePath || item.name)
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '')
  if (source.id === rootId) return rel
  if (source.parentId === rootId) {
    const sub = (source.subPath ?? '')
      .replaceAll('\\', '/')
      .replace(/^\/+|\/+$/g, '')
    // relativePath zaten tam sürücü yolu ise tekrar sub ekleme
    const relKey = normalizeRelPath(rel)
    const subKey = normalizeRelPath(sub)
    if (sub && (relKey === subKey || relKey.startsWith(`${subKey}/`))) return rel
    return sub ? `${sub}/${rel}` : rel
  }
  return null
}

function normalizeRelPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').toLowerCase()
}

/** Aynı normalize subPath’e düşen çocuk kaynakları tekilleştir; saklanan id’yi döndür. */
function dedupeChildrenBySubPath(
  children: readonly SourceUi[],
): { kept: SourceUi[]; idMap: Map<string, string> } {
  const byNorm = new Map<string, SourceUi>()
  const idMap = new Map<string, string>()
  const sorted = [...children].sort((a, b) => a.addedAt - b.addedAt)
  for (const child of sorted) {
    const key = normalizeRelPath(child.subPath ?? '')
    const prev = byNorm.get(key)
    if (!prev) {
      byNorm.set(key, child)
      idMap.set(child.id, child.id)
      continue
    }
    // Orijinal case’i koru (MISC > misc): büyük harf oranı veya localPath
    const prevScore = casingScore(prev.subPath ?? '')
    const nextScore = casingScore(child.subPath ?? '')
    if (nextScore > prevScore) {
      idMap.set(prev.id, child.id)
      idMap.set(child.id, child.id)
      byNorm.set(key, { ...child })
    } else {
      idMap.set(child.id, prev.id)
    }
  }
  return { kept: [...byNorm.values()], idMap }
}

/** Büyük harf / karışık yazım tercih skoru — tamamen küçük harften kaçın. */
function casingScore(path: string): number {
  let upper = 0
  let lower = 0
  for (const ch of path) {
    if (ch >= 'A' && ch <= 'Z') upper += 1
    else if (ch >= 'a' && ch <= 'z') lower += 1
  }
  if (upper === 0 && lower === 0) return 0
  // Karışık veya tamamen büyük > tamamen küçük
  if (upper > 0 && lower > 0) return 2 + upper
  if (upper > 0) return 1 + upper
  return 0
}

/** Aynı harfteki mevcut sürücü çapasını bul (localPath veya etiket). */
function findAnchorForDriveLetter(
  sources: readonly SourceUi[],
  letter: string,
): SourceUi | undefined {
  const want = letter.toUpperCase()
  for (const source of sources) {
    if (!source.isAnchor && !isDriveRootPath(source.localPath)) continue
    const fromPath = driveLetterOf(source.localPath)
    const fromLabel = driveLetterOf(drivePathFromLabel(source.label))
    if (fromPath === want || fromLabel === want) return source
  }
  return undefined
}

/**
 * parentId’si kayıp çocuklardan sürücü çapası kurtar (tarama yarıda kalınca).
 * Aynı harfte gerçek çapa varsa yenisini uydurma — öksüzleri ona bağla.
 */
function recoverMissingAnchors(sources: readonly SourceUi[]): SourceUi[] {
  const byId = new Set(sources.map((s) => s.id))
  const orphans = new Map<string, SourceUi[]>()
  for (const source of sources) {
    if (!source.parentId || byId.has(source.parentId)) continue
    const list = orphans.get(source.parentId) ?? []
    list.push(source)
    orphans.set(source.parentId, list)
  }
  if (orphans.size === 0) return sources as SourceUi[]

  const recovered: SourceUi[] = []
  const reparentTo = new Map<string, string>()
  let working: SourceUi[] = [...sources]

  for (const [parentId, kids] of orphans) {
    let root = ''
    for (const kid of kids) {
      const p = (kid.localPath ?? '').replace(/\//g, '\\')
      const m = /^([A-Za-z]:)(?:\\|$)/.exec(p)
      if (!m) continue
      root = `${m[1].toUpperCase()}:\\`
      break
    }
    if (!root) continue
    const letter = driveLetterOf(root)
    if (!letter) continue

    const existing = findAnchorForDriveLetter(working, letter)
    if (existing) {
      reparentTo.set(parentId, existing.id)
      continue
    }

    const anchor: SourceUi = {
      id: parentId,
      label: `${letter}: (kurtarıldı)`,
      localPath: root,
      addedAt: Math.min(...kids.map((k) => k.addedAt)),
      isAnchor: true,
    }
    recovered.push(anchor)
    working = [...working, anchor]
  }

  if (reparentTo.size > 0) {
    working = working.map((source) => {
      const nextParent = source.parentId
        ? reparentTo.get(source.parentId)
        : undefined
      return nextParent ? { ...source, parentId: nextParent } : source
    })
  }

  if (recovered.length === 0 && reparentTo.size === 0) {
    return sources as SourceUi[]
  }
  return recovered.length > 0
    ? [...working.filter((s) => !recovered.some((r) => r.id === s.id)), ...recovered]
    : working
}

/**
 * Aynı sürücü harfinde birden fazla çapa varsa tekilleştir.
 * "(kurtarıldı)" hayaletini gerçek (Elements vb.) kayda birleştirir.
 */
function mergeDuplicateDriveAnchors(sources: readonly SourceUi[]): {
  sources: SourceUi[]
  removedIds: string[]
  idMap: Map<string, string>
} {
  const byLetter = new Map<string, SourceUi[]>()
  for (const source of sources) {
    if (!source.isAnchor && !isDriveRootPath(source.localPath)) continue
    const letter =
      driveLetterOf(source.localPath) ??
      driveLetterOf(drivePathFromLabel(source.label))
    if (!letter) continue
    const list = byLetter.get(letter) ?? []
    list.push(source)
    byLetter.set(letter, list)
  }

  const removedIds: string[] = []
  const idMap = new Map<string, string>()
  let result = [...sources]

  const preferAnchor = (a: SourceUi, b: SourceUi): number => {
    const aGhost = /\(kurtarıldı\)/i.test(a.label) ? 1 : 0
    const bGhost = /\(kurtarıldı\)/i.test(b.label) ? 1 : 0
    if (aGhost !== bGhost) return aGhost - bGhost
    // Hacim adı olan etiket (Elements…) düz "E:" / "E: (kurtarıldı)"den iyidir
    if (a.label.length !== b.label.length) return b.label.length - a.label.length
    return a.addedAt - b.addedAt
  }

  for (const [, group] of byLetter) {
    if (group.length < 2) continue
    const sorted = [...group].sort(preferAnchor)
    const keeper = sorted[0]
    for (const loser of sorted.slice(1)) {
      removedIds.push(loser.id)
      idMap.set(loser.id, keeper.id)
      result = result.map((source) =>
        source.parentId === loser.id
          ? { ...source, parentId: keeper.id }
          : source,
      )
    }
  }

  if (removedIds.length === 0) {
    return { sources: sources as SourceUi[], removedIds, idMap }
  }

  result = result.filter((source) => !removedIds.includes(source.id))

  // Aynı çapa altında çift subPath çocuklarını birleştir
  const parentIds = new Set(
    result.filter((s) => s.parentId).map((s) => s.parentId as string),
  )
  for (const parentId of parentIds) {
    const kids = result.filter((s) => s.parentId === parentId)
    if (kids.length < 2) continue
    const { kept, idMap: childMap } = dedupeChildrenBySubPath(kids)
    for (const [from, to] of childMap) {
      if (from !== to) {
        idMap.set(from, to)
        removedIds.push(from)
      }
    }
    const keepIds = new Set(kept.map((k) => k.id))
    result = result.filter(
      (s) => s.parentId !== parentId || keepIds.has(s.id),
    )
    result = result.map((s) => kept.find((k) => k.id === s.id) ?? s)
  }

  return { sources: result, removedIds, idMap }
}

/** Aynı dosya için GPS birleştir: yeni konum varsa al, yoksa eskisini koru. */
function mergeScanMedia(scanned: MediaItem, prev: MediaItem | undefined): MediaItem {
  if (!prev) return scanned
  const scannedHasGps =
    !scanned.locationMissing &&
    !isNullIslandCoordinate(scanned.latitude, scanned.longitude)
  const prevHasGps =
    !prev.locationMissing &&
    !isNullIslandCoordinate(prev.latitude, prev.longitude)
  if (scannedHasGps) {
    return {
      ...scanned,
      gpsExtractFailed: false,
      takenAt: scanned.takenAt ?? prev.takenAt,
    }
  }
  if (prevHasGps) {
    return {
      ...scanned,
      latitude: prev.latitude,
      longitude: prev.longitude,
      locationMissing: false,
      gpsExtractFailed: false,
      takenAt: scanned.takenAt ?? prev.takenAt,
    }
  }
  // Yeni tarama API hatası verdiyse bayrağı koru; kesin yoksa false yaz.
  return {
    ...scanned,
    gpsExtractFailed: scanned.gpsExtractFailed === true
      ? true
      : scanned.locationMissing
        ? scanned.gpsExtractFailed === false
          ? false
          : prev.gpsExtractFailed
        : false,
    takenAt: scanned.takenAt ?? prev.takenAt,
  }
}

/** Medyanın bağlı olduğu kaynak; çocuk yoksa çevrimiçi çapaya düş. */
function findSourceForItem(
  item: MediaItem,
  sources: readonly SourceUi[],
  grantedIds: ReadonlySet<string>,
  localOnlineIds: ReadonlySet<string>,
  localAvailabilityReady: boolean,
  handleIds?: ReadonlySet<string>,
): SourceUi | undefined {
  const direct = sources.find((candidate) => candidate.id === item.sourceId)
  if (direct) return direct
  for (const anchor of sources) {
    if (!anchor.isAnchor) continue
    if (
      !isSourceOnline(
        anchor,
        sources,
        grantedIds,
        localOnlineIds,
        localAvailabilityReady,
        handleIds,
      )
    ) {
      continue
    }
    return anchor
  }
  return undefined
}

/** Dosyanın bulunduğu klasörler (sürücü ağacı çocukları) + ara yollar. */
function mediaFolderSubPaths(items: readonly MediaItem[]): string[] {
  const dirs = new Set<string>()
  let rootFiles = false
  for (const item of items) {
    const rel = (item.relativePath || item.name).replaceAll('\\', '/')
    const slash = rel.lastIndexOf('/')
    if (slash < 0) {
      rootFiles = true
      continue
    }
    const folder = rel.slice(0, slash)
    dirs.add(folder)
    // Ara klasörler de kaynak olsun (GoPro, DJI…) — yoksa yaprak sayacı 0 kalır
    const parts = folder.split('/').filter(Boolean)
    let acc = ''
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      dirs.add(acc)
    }
  }
  const list = [...dirs].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  if (rootFiles) list.unshift('')
  return list
}

function rewriteItemSource(
  item: MediaItem,
  newSourceId: string,
  newRel: string,
): MediaItem {
  const parts = item.id.split('|')
  const size = parts.length >= 3 ? parts[parts.length - 2] : '0'
  const mtime = parts.length >= 4 ? parts[parts.length - 1] : String(Date.now())
  return {
    ...item,
    sourceId: newSourceId,
    relativePath: newRel,
    id: `${newSourceId}|${newRel}|${size}|${mtime}`,
  }
}

/**
 * Medyanın sürücü köküne göreli yolu.
 * Çocuk sourceId, çapa, veya mutlak yol ile eşler — yetim / bayat id’leri de kapsar.
 */
function itemDriveRelativePath(
  item: MediaItem,
  driveId: string,
  sources: readonly SourceUi[],
): string | null {
  const under = itemPathUnderRoot(item, sources, driveId)
  if (under != null) return under

  const drive = sources.find((candidate) => candidate.id === driveId)
  const root =
    (drive ? localPathForSource(drive, sources) : undefined) ?? drive?.localPath
  if (!root?.trim()) return null

  const abs = windowsPathForItem(item, sources)
  if (!abs) return null
  const normRoot = normalizeWinPath(root)
  const normAbs = normalizeWinPath(abs)
  if (normAbs === normRoot) return ''
  if (!normAbs.startsWith(`${normRoot}\\`)) return null
  // Dilim uzunluğu normalize edilmiş kökten; karakterler orijinal abs’ten
  return abs
    .replace(/\//g, '\\')
    .slice(normRoot.length + 1)
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '')
}

/** En uzun eşleşen çocuk klasöre medyayı yaz (yalnızca çapa id’si değil — tüm sürücü ailesi). */
function assignItemToDriveChild(
  item: MediaItem,
  driveRel: string,
  children: readonly { id: string; subPath: string }[],
): MediaItem {
  const rel = driveRel.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  const relKey = rel.toLowerCase()
  const sorted = [...children].sort((a, b) => b.subPath.length - a.subPath.length)
  for (const child of sorted) {
    const sub = (child.subPath ?? '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
    const subKey = sub.toLowerCase()
    if (sub === '') {
      if (!rel.includes('/')) return rewriteItemSource(item, child.id, rel || item.name)
      continue
    }
    if (relKey === subKey || relKey.startsWith(`${subKey}/`)) {
      const newRel = relKey === subKey ? item.name : rel.slice(sub.length + 1)
      return rewriteItemSource(item, child.id, newRel)
    }
  }
  return item
}

/**
 * Sürücü altındaki tüm medyayı (çocuk / yetim / bayat id) yaprak klasör kaynaklarına yeniden yaz.
 * Ara klasörde kalan göreli yollar (GoPro + 2021/file) yüzünden sayaç 0 sorununu giderir.
 */
function remapAllItemsUnderDrive(
  items: readonly MediaItem[],
  driveId: string,
  children: readonly { id: string; subPath: string }[],
  sources: readonly SourceUi[],
): MediaItem[] {
  if (children.length === 0) return items as MediaItem[]
  const childIds = new Set(children.map((c) => c.id))
  return items.map((item) => {
    const driveRel = itemDriveRelativePath(item, driveId, sources)
    if (driveRel == null) {
      if (item.sourceId !== driveId && !childIds.has(item.sourceId)) return item
      const rel = (item.relativePath || item.name).replaceAll('\\', '/')
      return assignItemToDriveChild(item, rel, children)
    }
    return assignItemToDriveChild(item, driveRel, children)
  })
}

/** Ağaç düğümü / sürücü için medya sayısı: kaynak id + yol öneki. */
function countItemsUnderDrivePrefix(
  items: readonly MediaItem[],
  enabledKinds: ReadonlySet<MediaKind>,
  driveId: string,
  prefix: string,
  sources: readonly SourceUi[],
  descendantSourceIds: readonly string[],
): number {
  const idSet = new Set(descendantSourceIds)
  // prefix (ağaç) ile rel (itemPathUnderRoot) aynı case olmalı — Windows yolları karışık gelebilir
  const norm = normalizeRelPath(prefix)
  let n = 0
  const seen = new Set<string>()
  for (const it of items) {
    if (/\.lrv$/i.test(it.name)) continue
    if (!enabledKinds.has(it.kind)) continue
    let match = idSet.has(it.sourceId)
    if (!match) {
      const rel = itemDriveRelativePath(it, driveId, sources)
      if (rel != null) {
        const relKey = normalizeRelPath(rel)
        match = !norm
          ? true
          : relKey === norm || relKey.startsWith(`${norm}/`)
      }
    } else if (norm) {
      // Kaynak düğümde ama göreli yol bu önekin dışındaysa (üst kaynak + alt yol) sayma
      const rel = itemDriveRelativePath(it, driveId, sources)
      if (rel != null) {
        const relKey = normalizeRelPath(rel)
        if (!(relKey === norm || relKey.startsWith(`${norm}/`))) {
          match = false
        }
      }
    }
    if (!match) continue
    if (seen.has(it.id)) continue
    seen.add(it.id)
    n += 1
  }
  return n
}

/** Yerel yol varsa disk erişimi; yoksa File System Access izni. */
function isSourceOnline(
  source: SourceUi,
  allSources: readonly SourceUi[],
  grantedIds: ReadonlySet<string>,
  localOnlineIds: ReadonlySet<string>,
  localAvailabilityReady: boolean,
  handleIds?: ReadonlySet<string>,
): boolean {
  const path = localPathForSource(source, allSources)
  if (path) {
    // Availability henüz gelmediyse yollu kaynağı çevrimdışı sayma
    if (!localAvailabilityReady) return true
    if (localOnlineIds.has(source.id)) return true
    // Alt klasör yolu başarısız olsa bile sürücü çapası online ise medyayı gizleme
    if (source.parentId) {
      const parent = allSources.find((item) => item.id === source.parentId)
      if (
        parent &&
        isSourceOnline(
          parent,
          allSources,
          grantedIds,
          localOnlineIds,
          localAvailabilityReady,
          handleIds,
        )
      ) {
        return true
      }
    }
    // Türetilmiş/bayat yerel yol offline olsa bile canlı FSA handle + izin varsa bağlı
    // (yalnızca handle'lı kaynaklar; yerel taramanın grantedIds yazması yeterli değil)
    if (handleIds?.has(source.id) && grantedIds.has(source.id)) return true
    return false
  }
  return grantedIds.has(source.id)
}

/** Satırda ↪ gösterilen kaynaklar: bağlı değil / izin yok. */
function sourceNeedsReconnect(
  source: SourceUi,
  allSources: readonly SourceUi[],
  grantedIds: ReadonlySet<string>,
  localOnlineIds: ReadonlySet<string>,
  localAvailabilityReady: boolean,
  handleIds: ReadonlySet<string>,
): boolean {
  if (source.isAnchor) {
    const kids = allSources.filter((c) => c.parentId === source.id)
    const rootSource = kids.find((child) => child.subPath === '')
    const linked =
      Boolean(source.localPath) ||
      Boolean(localPathForSource(source, allSources)) ||
      Boolean(rootSource?.localPath) ||
      localOnlineIds.has(source.id) ||
      isSourceOnline(
        source,
        allSources,
        grantedIds,
        localOnlineIds,
        localAvailabilityReady,
        handleIds,
      )
    return !linked
  }
  return !isSourceOnline(
    source,
    allSources,
    grantedIds,
    localOnlineIds,
    localAvailabilityReady,
    handleIds,
  )
}

/** Tarama sırasında bilinen Windows yolu; Explorer / VLC için. */
function windowsPathForItem(
  item: MediaItem,
  allSources: readonly SourceUi[],
): string | undefined {
  const raw = item.relativePath || item.name
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    return raw.replace(/\//g, '\\')
  }
  const source = allSources.find((candidate) => candidate.id === item.sourceId)
  if (!source) return undefined
  const root = localPathForSource(source, allSources)
  if (!root) return undefined
  const rel = raw.replace(/\//g, '\\').replace(/^\\+/, '')
  if (!rel) return root.replace(/[\\/]+$/, '')
  return `${root.replace(/[\\/]+$/, '')}\\${rel}`
}

/** API resolve / reveal / play için kök + göreli yol (sürücü çapası tercih). */
function apiPathsForItem(
  item: MediaItem,
  allSources: readonly SourceUi[],
): {
  rootPath?: string
  relativePath: string
  builtPath?: string
} {
  const source = allSources.find((s) => s.id === item.sourceId)
  const anchor =
    source?.isAnchor
      ? source
      : source?.parentId
        ? allSources.find((s) => s.id === source.parentId)
        : allSources.find(
            (s) => s.isAnchor && itemDriveRelativePath(item, s.id, allSources) != null,
          )

  let rootPath =
    (source ? localPathForSource(source, allSources) : undefined) || source?.localPath
  let relativePath = item.relativePath || item.name

  if (anchor) {
    const driveRoot = localPathForSource(anchor, allSources) ?? anchor.localPath
    const driveRel = itemDriveRelativePath(item, anchor.id, allSources)
    if (driveRoot && driveRel != null) {
      rootPath = driveRoot
      relativePath = driveRel || item.name
    }
  }

  return {
    rootPath,
    relativePath,
    builtPath: windowsPathForItem(item, allSources),
  }
}

interface SourceTreeNode {
  /** Çapa göreli yol; kök için ''. */
  path: string
  name: string
  source?: SourceUi
  children: SourceTreeNode[]
}

function buildSourceTree(children: SourceUi[]): SourceTreeNode[] {
  const { kept } = dedupeChildrenBySubPath(children)
  const root: SourceTreeNode = { path: '', name: '', children: [] }

  const ensure = (parts: string[]): SourceTreeNode => {
    let node = root
    let path = ''
    for (const part of parts) {
      const partKey = part.toLowerCase()
      let child = node.children.find((c) => c.name.toLowerCase() === partKey)
      if (!child) {
        path = path ? `${path}/${part}` : part
        child = { path, name: part, children: [] }
        node.children.push(child)
      } else {
        path = child.path
      }
      node = child
    }
    return node
  }

  for (const source of kept) {
    const raw = source.subPath?.trim() ?? ''
    if (!raw) {
      root.children.push({
        path: '',
        name: '(kök)',
        source,
        children: [],
      })
      continue
    }
    const node = ensure(raw.split('/').filter(Boolean))
    // Daha iyi case’li kaynağı tercih et
    if (
      !node.source ||
      casingScore(source.subPath ?? '') > casingScore(node.source.subPath ?? '')
    ) {
      node.source = source
      node.path = raw.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
      node.name = raw.split('/').filter(Boolean).pop() || node.name
    }
  }

  const sortRec = (nodes: SourceTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    for (const n of nodes) sortRec(n.children)
  }
  sortRec(root.children)
  return root.children
}

function collectDescendantSourceIds(node: SourceTreeNode): string[] {
  const ids: string[] = []
  if (node.source) ids.push(node.source.id)
  for (const child of node.children) {
    ids.push(...collectDescendantSourceIds(child))
  }
  return ids
}

/** Ağaç düğümü için disk yolu: kaynak yolu veya çapa + göreli path. */
function localPathForTreeNode(
  anchor: SourceUi | undefined,
  node: SourceTreeNode,
  allSources: readonly SourceUi[],
): string | undefined {
  if (node.source) {
    const fromSource =
      localPathForSource(node.source, allSources) ?? node.source.localPath
    if (fromSource?.trim()) return fromSource
  }
  if (!anchor) return undefined
  const root = localPathForSource(anchor, allSources) ?? anchor.localPath
  if (!root?.trim()) return undefined
  const sub = (node.path || node.source?.subPath || '')
    .replaceAll('/', '\\')
    .replace(/^\\+|\\+$/g, '')
  if (!sub) return root
  return `${root.replace(/[\\/]+$/, '')}\\${sub}`
}

/** Çapa altında `prefix` ve altındaki çocuk kaynak id’leri. */
function driveSubtreeSourceIds(
  driveId: string,
  prefix: string,
  sources: readonly SourceUi[],
): Set<string> {
  const ids = new Set<string>()
  const norm = normalizeRelPath(prefix)
  for (const source of sources) {
    if (source.parentId !== driveId || source.subPath == null) continue
    const sp = normalizeRelPath(source.subPath)
    if (sp === norm || (norm && sp.startsWith(`${norm}/`))) ids.add(source.id)
  }
  return ids
}

/** Sürücü ağacını (ara klasörler dahil) açık göstermek için expand anahtarları. */
function expandKeysForDriveChildren<T extends { subPath?: string }>(
  anchorId: string,
  children: readonly T[],
): string[] {
  const keys = new Set<string>([`${anchorId}::`])
  for (const child of children) {
    const parts = (child.subPath || '').split('/').filter(Boolean)
    let path = ''
    for (const part of parts) {
      path = path ? `${path}/${part}` : part
      keys.add(`${anchorId}::${path}`)
    }
  }
  return [...keys]
}

const FILTER_KEY = 'konumnerede-media-filters'
const HIDDEN_SOURCES_KEY = 'konumnerede-hidden-sources'
const ALL_KINDS: MediaKind[] = ['photo', 'video', 'gopro', 'drone']

function loadHiddenSources(): Set<string> {
  try {
    const saved = JSON.parse(
      localStorage.getItem(HIDDEN_SOURCES_KEY) ?? '[]',
    ) as unknown
    if (Array.isArray(saved)) return new Set(saved.filter((v) => typeof v === 'string'))
  } catch {
    // Varsayılana düş
  }
  return new Set()
}

function loadFilters(): Set<MediaKind> {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_KEY) ?? '[]') as unknown
    if (Array.isArray(saved)) {
      const valid = saved.filter((v): v is MediaKind =>
        ALL_KINDS.includes(v as MediaKind),
      )
      if (valid.length > 0) return new Set(valid)
    }
  } catch {
    // Varsayılanlara düş
  }
  return new Set(ALL_KINDS)
}

function acceptsFileName(name: string, kinds: ReadonlySet<MediaKind>): boolean {
  if (/\.lrv$/i.test(name)) return false
  if (getExtension(name) === 'xmp' || getExtension(name) === 'srt') return true
  const kind = detectKind(name)
  return kind !== null && kinds.has(kind)
}

/** Kaynak keşfi, ekrandaki tür filtresinden bağımsız tüm desteklenen medyayı görür. */
function isSupportedMediaFileName(name: string): boolean {
  if (/\.lrv$/i.test(name)) return false
  if (getExtension(name) === 'xmp' || getExtension(name) === 'srt') return true
  return detectKind(name) !== null
}

async function forEachWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  task: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < values.length) {
      const value = values[nextIndex]
      nextIndex += 1
      await task(value)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  )
}

function toLibraryItem(item: MediaItem): LibraryItem {
  return {
    id: item.id,
    sourceId: item.sourceId,
    relativePath: item.relativePath,
    name: item.name,
    kind: item.kind,
    latitude: item.latitude,
    longitude: item.longitude,
    takenAt: item.takenAt ? item.takenAt.getTime() : undefined,
    width: item.width,
    height: item.height,
    locationMissing: item.locationMissing,
    gpsExtractFailed: item.gpsExtractFailed,
  }
}

/** Kaynak kaydı silinmiş ama kütüphane kalmışsa etiket üret. */
function inferSourceLabelFromItems(items: LibraryItem[]): string {
  if (items.length === 0) return 'Kayıt'
  const folderCounts = new Map<string, number>()
  for (const item of items) {
    const parts = (item.relativePath || item.name)
      .replaceAll('\\', '/')
      .split('/')
      .filter(Boolean)
    const folder =
      parts.length > 1 ? parts[parts.length - 2] : parts[0]?.replace(/\.[^.]+$/, '')
    if (!folder) continue
    folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [name, count] of folderCounts) {
    if (count > bestCount) {
      best = name
      bestCount = count
    }
  }
  if (best) return best
  const sample = items[0]
  return (
    sample.relativePath?.split(/[\\/]/).filter(Boolean).pop() ??
    sample.name.replace(/\.[^.]+$/, '') ??
    'Kayıt'
  )
}

/** IndexedDB’de kaynak yok ama medya var — kaynak listesini kütüphaneden yeniden kur. */
function recoverSourcesFromLibrary(lib: LibraryItem[]): SourceRecord[] {
  const bySource = new Map<string, LibraryItem[]>()
  for (const item of lib) {
    if (!item.sourceId) continue
    const list = bySource.get(item.sourceId) ?? []
    list.push(item)
    bySource.set(item.sourceId, list)
  }
  const recovered: SourceRecord[] = []
  let idx = 0
  for (const [sourceId, group] of bySource) {
    recovered.push({
      id: sourceId,
      label: inferSourceLabelFromItems(group),
      addedAt: Date.now() - idx,
    })
    idx += 1
  }
  return recovered.sort((a, b) => a.addedAt - b.addedAt)
}

export default function App() {
  const [items, setItems] = useState<MediaItem[]>([])
  const [showLocationMissing, setShowLocationMissing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [driveDialogOpen, setDriveDialogOpen] = useState(false)
  const [drivePath, setDrivePath] = useState('')
  const [driveLabel, setDriveLabel] = useState('')
  const [availableDrives, setAvailableDrives] = useState<
    Array<{ letter: string; path: string; label: string; volumeName: string | null }>
  >([])
  const [drivesLoading, setDrivesLoading] = useState(false)
  const [drivesError, setDrivesError] = useState<string | null>(null)
  const [language, setLanguage] = useState<'tr' | 'en'>(() =>
    localStorage.getItem('mediaatlas-language') === 'en' ? 'en' : 'tr',
  )
  const [localOnlineIds, setLocalOnlineIds] = useState<Set<string>>(new Set())
  const [localAvailabilityReady, setLocalAvailabilityReady] = useState(false)
  const [enabledKinds, setEnabledKinds] = useState<Set<MediaKind>>(loadFilters)
  const [sources, setSources] = useState<SourceUi[]>([])
  const [grantedIds, setGrantedIds] = useState<Set<string>>(new Set())
  const [hiddenSourceIds, setHiddenSourceIds] =
    useState<Set<string>>(loadHiddenSources)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [reconnectingAll, setReconnectingAll] = useState(false)
  const [typeMenuLocation, setTypeMenuLocation] = useState<'located' | 'missing' | null>(null)
  /** Açık ağaç düğümleri: `${anchorId}::${path}` */
  const [expandedTree, setExpandedTree] = useState<Set<string>>(() => new Set())
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null)
  const [galleryScope, setGalleryScope] = useState<GalleryScope>(() => loadGalleryScope())
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [placeHits, setPlaceHits] = useState<PlaceHit[]>([])
  const [placeSearchOpen, setPlaceSearchOpen] = useState(false)
  const [placeSearching, setPlaceSearching] = useState(false)
  const [flyTo, setFlyTo] = useState<{
    id: string
    latitude: number
    longitude: number
    bbox?: [number, number, number, number]
  } | null>(null)
  /** Haritadaki pine tıklanınca galeri yalnızca o küme; pan ile temizlenir. */
  const [pinItems, setPinItems] = useState<MediaItem[] | null>(null)
  const pinLockRef = useRef(0)
  const [viewer, setViewer] = useState<MediaItem | null>(null)
  const [viewerAutoPlay, setViewerAutoPlay] = useState(false)
  const [tracks, setTracks] = useState<MapTrack[]>([])
  const [tracksHydrated, setTracksHydrated] = useState(false)
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)
  const [ridesOpen, setRidesOpen] = useState(false)
  const appEdition = getAppEdition()
  const editionV2 = isEditionV2()
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null)
  // Kaynak başına eşzamanlı tarama ilerlemesi
  const [scans, setScans] = useState<Map<string, { done: number; total: number; located?: number; missing?: number }>>(
    () => new Map(),
  )
  const [, setSkipped] = useState(0)
  const [skippedNames, setSkippedNames] = useState<string[]>([])
  const [error, setErrorState] = useState<string | null>(null)
  const [toastKind, setToastKind] = useState<'error' | 'info'>('error')
  const errorTimerRef = useRef<number | null>(null)

  const setError = useCallback((message: string | null, kind: 'error' | 'info' = 'error') => {
    if (errorTimerRef.current != null) {
      window.clearTimeout(errorTimerRef.current)
      errorTimerRef.current = null
    }
    setErrorState(message)
    setToastKind(kind)
    if (message) {
      const ms = kind === 'error' ? 5000 : 2500
      errorTimerRef.current = window.setTimeout(() => {
        setErrorState(null)
        errorTimerRef.current = null
      }, ms)
    }
  }, [])

  const [cachedCount, setCachedCount] = useState(0)
  const [notice, setNotice] = useState<{
    title: string
    message: string
    stats?: Array<{ label: string; value: string }>
  } | null>(null)
  const [localApiAvailable, setLocalApiAvailable] = useState(false)
  const [sessionResume, setSessionResume] = useState<{
    itemCount: number
    driveCount: number
    sourceCount: number
  } | null>(null)
  /** StrictMode / çift yüklemede diyaloğun ikinci kez açılmasını engelle */
  const sessionResumeHandledRef = useRef(false)
  const desktopMode = isDesktopRuntime()
  const showDesktopSources = desktopMode || localApiAvailable
  /** PC’de tek sürücü ekle (telefon/tablet’te yok). API baslat-v2 ile gelir. */
  const showDriveAdd = !isMobileClient()

  const busy = scans.size > 0
  const folderInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rideFileInputRef = useRef<HTMLInputElement>(null)
  const sourcesMenuRef = useRef<HTMLDivElement>(null)
  const ridesMenuRef = useRef<HTMLDivElement>(null)
  const searchFieldRef = useRef<HTMLDivElement>(null)
  const typesMenuRef = useRef<HTMLDivElement>(null)
  const scanControllersRef = useRef<Map<string, AbortController>>(new Map())
  const scanJobIdsRef = useRef<Map<string, string>>(new Map())
  const handlesRef = useRef<Map<string, FileSystemDirectoryHandle>>(new Map())
  const fileMapRef = useRef<Map<string, File>>(new Map())
  const urlCacheRef = useRef<Map<string, string>>(new Map())
  const thumbCacheRef = useRef<Map<string, ThumbInfo | null>>(new Map())
  const thumbPendingRef = useRef<Map<string, Promise<ThumbInfo | null>>>(new Map())
  const itemsRef = useRef<MediaItem[]>([])
  const enabledKindsRef = useRef(enabledKinds)
  const sourcesRef = useRef<SourceUi[]>([])
  itemsRef.current = items
  enabledKindsRef.current = enabledKinds
  sourcesRef.current = sources

  useEffect(() => {
    let alive = true
    const check = async () => {
      const localSources = sources
        .map((source) => ({ id: source.id, path: localPathForSource(source, sources) }))
        .filter((source): source is { id: string; path: string } => Boolean(source.path))
      if (localSources.length === 0) {
        if (alive) {
          // Aktif tarama kaynaklarını silme — yoksa tarama sırasında pinler kaybolur
          setLocalOnlineIds((prev) => {
            const keep = new Set<string>()
            for (const id of scanJobIdsRef.current.keys()) keep.add(id)
            for (const id of prev) {
              if (scanControllersRef.current.has(id)) keep.add(id)
            }
            return keep
          })
          setLocalAvailabilityReady(false)
        }
        return
      }
      try {
        const response = await fetch('/api/availability', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sources: localSources }),
        })
        const data = await response.json() as { available?: string[] }
        if (alive && response.ok) {
          setLocalApiAvailable(true)
          setLocalOnlineIds((prev) => {
            const next = new Set(data.available ?? [])
            // Tarama süresince işaretlenen kaynakları availability üzerine yazma
            for (const id of scanJobIdsRef.current.keys()) next.add(id)
            for (const id of scanControllersRef.current.keys()) next.add(id)
            for (const id of prev) {
              if (scanControllersRef.current.has(id) || scanJobIdsRef.current.has(id)) {
                next.add(id)
              }
            }
            return next
          })
          setLocalAvailabilityReady(true)
        }
      } catch {
        // Eski yerel hizmet çalışıyorsa medyayı gizleme; tarayıcının mevcut
        // bağlantı bilgisini kullanmaya devam et.
        if (alive) setLocalAvailabilityReady(false)
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), 5000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [sources])

  useEffect(() => {
    if (!driveDialogOpen) return
    let alive = true
    setDrivesLoading(true)
    setDrivesError(null)
    void (async () => {
      let apiOk = false
      try {
        apiOk = await probeLocalApi(2500, 2)
        if (!alive) return
        setLocalApiAvailable(apiOk)
        if (!apiOk) {
          setAvailableDrives([])
          setDrivesError(localApiMissingHint(editionV2 ? 'v2' : 'v1'))
          return
        }

        const response = await fetch('/api/drives')
        const raw = await response.text()
        let data: {
          error?: string
          drives?: Array<{ letter: string; path: string; label: string; volumeName: string | null }>
        } = {}
        try {
          data = JSON.parse(raw) as typeof data
        } catch {
          throw new Error('API yanıtı geçersiz (proxy / yanlış port?).')
        }
        if (!alive) return
        if (!response.ok) throw new Error(data.error || 'Sürücüler okunamadı.')
        const drives = data.drives ?? []
        setAvailableDrives(drives)

        const addedLetters = new Set<string>()
        for (const source of sourcesRef.current) {
          const root = source.localPath ?? localPathForSource(source, sourcesRef.current)
          if (isDriveRootPath(root) || source.isAnchor) {
            const letter = driveLetterOf(root) ?? driveLetterOf(source.localPath)
            if (letter) addedLetters.add(letter)
          }
        }

        const selectable = drives.filter((d) => !addedLetters.has(d.letter.toUpperCase()))
        const preferred =
          selectable.find((d) => d.path.toUpperCase() === drivePath.toUpperCase())
          ?? selectable.find((d) => d.letter !== 'C')
          ?? selectable[0]
          // Hepsi ekliyse yine bir sürücü seç — yeniden tarama için
          ?? drives.find((d) => d.path.toUpperCase() === drivePath.toUpperCase())
          ?? drives.find((d) => addedLetters.has(d.letter.toUpperCase()) && d.letter !== 'C')
          ?? drives.find((d) => addedLetters.has(d.letter.toUpperCase()))
          ?? drives[0]
          ?? null

        if (preferred) {
          setDrivePath(preferred.path)
          setDriveLabel(preferred.label)
        } else {
          setDrivePath('')
          setDriveLabel('')
        }
      } catch (err) {
        if (!alive) return
        setAvailableDrives([])
        if (!apiOk) {
          setDrivesError(localApiMissingHint(editionV2 ? 'v2' : 'v1'))
          return
        }
        const detail = err instanceof Error && err.message ? ` ${err.message}` : ''
        setDrivesError(
          `Sürücü listesi alınamadı.${detail} baslat-v2.bat’ı yeniden başlatmayı dene.`,
        )
      } finally {
        if (alive) setDrivesLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [driveDialogOpen, editionV2])

  const addedDriveLetters = useMemo(() => {
    const letters = new Set<string>()
    for (const source of sources) {
      const root = source.localPath ?? localPathForSource(source, sources)
      if (isDriveRootPath(root) || (source.isAnchor && root)) {
        const letter = driveLetterOf(root)
        if (letter) letters.add(letter)
      } else if (isDriveRootPath(source.localPath)) {
        const letter = driveLetterOf(source.localPath)
        if (letter) letters.add(letter)
      }
    }
    return letters
  }, [sources])

  // Kütüphane: kaynak gizli değilse göster (disk offline olsa da pin kalsın).
  // available bayrağı dosya açılabilirliğini belirtir.
  const availableItems = useMemo(
    () => {
      const handleIds = new Set(handlesRef.current.keys())
      return items
        .filter(
          (it) =>
            enabledKinds.has(it.kind) &&
            !/\.lrv$/i.test(it.name) &&
            !hiddenSourceIds.has(it.sourceId),
        )
        .map((it) => {
          const source = findSourceForItem(
            it,
            sources,
            grantedIds,
            localOnlineIds,
            localAvailabilityReady,
            handleIds,
          )
          const online = source
            ? isSourceOnline(
                source,
                sources,
                grantedIds,
                localOnlineIds,
                localAvailabilityReady,
                handleIds,
              )
            : false
          // Aynı referansı koru — GPS birleştirmelerinde tüm önizlemeler remount olmasın
          if (it.available === online) return it
          return { ...it, available: online }
        })
    },
    [items, grantedIds, enabledKinds, hiddenSourceIds, sources, localOnlineIds, localAvailabilityReady],
  )
  const selectedTrack = useMemo(
    () => tracks.find((t) => t.id === selectedTrackId) ?? null,
    [tracks, selectedTrackId],
  )

  const trackFocusItems = useMemo(() => {
    if (!selectedTrack) return null
    return itemsOnTrackDates(availableItems, selectedTrack)
  }, [availableItems, selectedTrack])

  const clusters = useMemo(() => {
    if (showLocationMissing) return []
    const poolBase = trackFocusItems ?? availableItems
    const pool = poolBase.filter((item) => {
      if (item.locationMissing) return false
      const sourceLabel = sources.find((s) => s.id === item.sourceId)?.label
      return itemMatchesQuery(item, searchQuery, sourceLabel)
    })
    // V2: daha sıkı küme (yakın zoom’da ayrı pin); V1: mevcut 24 m
    return groupByLocation(pool, editionV2 ? 40 : 24)
  }, [
    availableItems,
    trackFocusItems,
    showLocationMissing,
    searchQuery,
    editionV2,
    sources,
  ])
  const locationCount = useMemo(
    () => new Set(
      availableItems
        .filter((item) => !item.locationMissing)
        .map((item) => `${item.latitude.toFixed(5)},${item.longitude.toFixed(5)}`),
    ).size,
    [availableItems],
  )
  // Kaynak başına kütüphane sayısı — seçili/gizli fark etmeksizin (yanındaki sayı)
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const it of items) {
      if (/\.lrv$/i.test(it.name)) continue
      if (!enabledKinds.has(it.kind)) continue
      counts.set(it.sourceId, (counts.get(it.sourceId) ?? 0) + 1)
    }
    return counts
  }, [items, enabledKinds])

  /** Üst listede gösterme: sürücü altına düşen yetim kökler (PANORAMA vb.). */
  const topLevelSources = useMemo(() => {
    const anchors = sources.filter((s) => s.isAnchor)
    const labelsUnderDrives = new Set<string>()
    for (const anchor of anchors) {
      for (const child of sources) {
        if (child.parentId !== anchor.id) continue
        const label = child.label.trim().toLowerCase()
        if (label) labelsUnderDrives.add(label)
        const leaf = (child.subPath || '')
          .replaceAll('\\', '/')
          .split('/')
          .filter(Boolean)
          .pop()
        if (leaf) labelsUnderDrives.add(leaf.toLowerCase())
      }
    }
    return sources.filter((s) => {
      // Çapa her zaman üstte — parentId yanlışlıkla set olsa bile
      if (s.isAnchor) return true
      if (s.parentId && sources.some((p) => p.id === s.parentId)) return false
      const path = (localPathForSource(s, sources) ?? s.localPath ?? '')
        .replace(/\//g, '\\')
        .replace(/[\\/]+$/, '')
        .toLowerCase()
      if (!path) {
        // Yolsuz yetim: medyası yoksa gösterme
        return (sourceCounts.get(s.id) ?? 0) > 0
      }
      for (const anchor of anchors) {
        const root = (
          localPathForSource(anchor, sources) ??
          anchor.localPath ??
          ''
        )
          .replace(/\//g, '\\')
          .replace(/[\\/]+$/, '')
          .toLowerCase()
        if (!root) continue
        if (path === root || path.startsWith(`${root}\\`)) return false
      }
      // Aynı etiket zaten sürücü ağacında varsa kökte tekrarlama
      if (labelsUnderDrives.has(s.label.trim().toLowerCase())) return false
      return true
    })
  }, [sources, sourceCounts])

  // Galeri: alan veya tüm kütüphane; en yeni üstte; GPS’li / GPS’siz ayrı
  const galleryItems = useMemo(() => {
    const matchQ = (item: MediaItem) => {
      const sourceLabel = sources.find((s) => s.id === item.sourceId)?.label
      return itemMatchesQuery(item, searchQuery, sourceLabel)
    }
    if (showLocationMissing) {
      return availableItems.filter((item) => item.locationMissing && matchQ(item))
    }
    if (trackFocusItems && !pinItems) {
      return trackFocusItems
        .filter((i) => !i.locationMissing && matchQ(i))
        .sort((a, b) => {
          if (a.takenAt && b.takenAt) return b.takenAt.getTime() - a.takenAt.getTime()
          if (a.takenAt) return -1
          if (b.takenAt) return 1
          return a.name.localeCompare(b.name)
        })
    }
    if (pinItems && galleryScope === 'area') {
      return pinItems
        .filter((i) => !i.locationMissing && matchQ(i))
        .sort((a, b) => {
          if (a.takenAt && b.takenAt) return b.takenAt.getTime() - a.takenAt.getTime()
          if (a.takenAt) return -1
          if (b.takenAt) return 1
          return a.name.localeCompare(b.name)
        })
    }
    const located = availableItems.filter((i) => !i.locationMissing && matchQ(i))
    const boundsOk = mapBounds && isSaneMapBounds(mapBounds)
    const list =
      galleryScope === 'all' || !mapBounds || !boundsOk
        ? located
        : located.filter((i) => inBounds(i.latitude, i.longitude, mapBounds))
    return list.sort((a, b) => {
      if (a.takenAt && b.takenAt) return b.takenAt.getTime() - a.takenAt.getTime()
      if (a.takenAt) return -1
      if (b.takenAt) return 1
      return a.name.localeCompare(b.name)
    })
  }, [
    availableItems,
    mapBounds,
    showLocationMissing,
    galleryScope,
    searchQuery,
    pinItems,
    trackFocusItems,
    sources,
  ])

  const locatedCount = useMemo(
    () => availableItems.filter((i) => !i.locationMissing).length,
    [availableItems],
  )

  const visibleSourceCount = useMemo(
    () => sources.filter((s) => !hiddenSourceIds.has(s.id)).length,
    [sources, hiddenSourceIds],
  )

  /** Konum bulunamayan — kütüphane havuzu (offline kaynaklar dahil, gizli/tür filtreli). */
  const missingLocationCount = useMemo(
    () => availableItems.filter((i) => i.locationMissing).length,
    [availableItems],
  )

  // Harita rozeti = galeri alan sayısı (aynı filtre)
  const visibleInArea = useMemo(() => {
    if (trackFocusItems && !pinItems) return trackFocusItems.length
    if (galleryScope === 'area' && pinItems) return pinItems.length
    if (!mapBounds || !isSaneMapBounds(mapBounds)) {
      return availableItems.filter((i) => !i.locationMissing).length
    }
    const q = searchQuery.trim()
    return availableItems.filter((i) => {
      if (i.locationMissing) return false
      const sourceLabel = sources.find((s) => s.id === i.sourceId)?.label
      if (!itemMatchesQuery(i, q, sourceLabel)) return false
      return inBounds(i.latitude, i.longitude, mapBounds)
    }).length
  }, [
    availableItems,
    mapBounds,
    pinItems,
    trackFocusItems,
    galleryScope,
    searchQuery,
    sources,
  ])

  const focusedItem = useMemo(
    () =>
      focusedItemId
        ? availableItems.find((item) => item.id === focusedItemId) ?? null
        : null,
    [availableItems, focusedItemId],
  )

  const focusPoint = useMemo(() => {
    if (!focusedItem || focusedItem.locationMissing) return null
    return {
      id: focusedItem.id,
      latitude: focusedItem.latitude,
      longitude: focusedItem.longitude,
    }
  }, [focusedItem])

  useEffect(() => {
    const cache = urlCacheRef.current
    const thumbCache = thumbCacheRef.current
    const controllers = scanControllersRef.current
    return () => {
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      for (const url of cache.values()) URL.revokeObjectURL(url)
      cache.clear()
      for (const info of thumbCache.values()) {
        if (info) URL.revokeObjectURL(info.url)
      }
      thumbCache.clear()
    }
  }, [])

  useEffect(() => {
    const input = folderInputRef.current
    if (input) {
      input.setAttribute('webkitdirectory', '')
      input.setAttribute('directory', '')
    }
  }, [])

  // Arama: ucuzbilet tarzı ~180ms debounce — yazarken UI donmasın
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput), 180)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  // Yer adı araması (Nominatim) — medya filtresinden biraz daha geç
  useEffect(() => {
    const q = searchInput.trim()
    if (q.length < 2) {
      setPlaceHits([])
      setPlaceSearching(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setPlaceSearching(true)
      void searchPlaces(q, controller.signal)
        .then((hits) => {
          if (controller.signal.aborted) return
          setPlaceHits(rankPlaces(hits, q))
          setPlaceSearchOpen(true)
        })
        .catch(() => {
          if (!controller.signal.aborted) setPlaceHits([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setPlaceSearching(false)
        })
    }, 450)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [searchInput])

  useEffect(() => {
    if (!placeSearchOpen) return
    const onDown = (e: MouseEvent) => {
      if (!searchFieldRef.current?.contains(e.target as Node)) {
        setPlaceSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [placeSearchOpen])

  // Tür menüsü: dışarı tıklayınca kapan
  useEffect(() => {
    if (!typeMenuLocation) return
    const onDown = (e: MouseEvent) => {
      if (!typesMenuRef.current?.contains(e.target as Node)) {
        setTypeMenuLocation(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [typeMenuLocation])

  useEffect(() => {
    if (!sourcesOpen) return
    const onDown = (e: MouseEvent) => {
      if (!sourcesMenuRef.current?.contains(e.target as Node)) setSourcesOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [sourcesOpen])

  useEffect(() => {
    if (!ridesOpen) return
    const onDown = (e: MouseEvent) => {
      if (!ridesMenuRef.current?.contains(e.target as Node)) setRidesOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [ridesOpen])

  // Ride güzergahlarını IndexedDB'den yükle
  useEffect(() => {
    void (async () => {
      const stored = await getStoredTracks()
      if (stored.length > 0) {
        // Eski 100k+ noktalı kayıtları sadeleştir (UI kilitlenmesi)
        setTracks(stored.map((t) => finalizeTrack(t)))
      }
      setTracksHydrated(true)
    })()
  }, [])

  // Ride güzergahlarını kalıcı tut
  useEffect(() => {
    if (!tracksHydrated) return
    void putStoredTracks(tracks)
  }, [tracks, tracksHydrated])

  useEffect(() => {
    let alive = true
    let consecutiveFails = 0
    const check = async () => {
      // Aktif tarama zaten API üzerinden gidiyor — probe'u yorma / banner'ı düşürme
      if (scanJobIdsRef.current.size > 0 || scanControllersRef.current.size > 0) {
        consecutiveFails = 0
        if (alive) setLocalApiAvailable(true)
        return
      }
      const ok = await probeLocalApi(3500, 3)
      if (!alive) return
      if (ok) {
        consecutiveFails = 0
        setLocalApiAvailable(true)
      } else {
        consecutiveFails += 1
        // Ağır galeri/filtre çizimi probe’u timeout’a düşürebilir — acele etme
        if (consecutiveFails >= 3) setLocalApiAvailable(false)
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), 5000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  // Açılışta kalıcı kütüphaneyi ve kaynakları yükle (tarama yok)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      let srcs = await getSources()
      if (cancelled) return
      const rawLib = await getLibraryItems()
      if (cancelled) return

      // LRV'ler değerlendirme dışı: eski kayıtları da temizle
       const invalidItems = rawLib.filter((l) => l.name.toLowerCase().endsWith('.lrv'))
       if (invalidItems.length > 0) {
         await deleteLibraryItems(invalidItems.map((l) => l.id))
       }
       const lib = rawLib.filter(
         (l) =>
            !l.name.toLowerCase().endsWith('.lrv'),
       )

      // Kaynak kaydı silinmiş ama kütüphane kalmış (Kaynaklar 0 görünümü)
      if (srcs.length === 0 && lib.length > 0) {
        const recovered = recoverSourcesFromLibrary(lib)
        for (const record of recovered) {
          await putSource(record)
        }
        srcs = recovered
      }

      // Tarihsiz eski kayıtları onar: kayıt kimliğinin son parçası
      // dosyanın değiştirilme zamanıdır (sourceId|yol|boyut|lastModified)
      const repaired: LibraryItem[] = []
      for (const l of lib) {
        if (l.takenAt) continue
        const lastModified = Number(l.id.slice(l.id.lastIndexOf('|') + 1))
        if (Number.isFinite(lastModified) && lastModified > 0) {
          l.takenAt = lastModified
          repaired.push(l)
        }
      }
      if (repaired.length > 0) {
        await putLibraryItems(repaired)
      }

      // Eski sürümden kalan "son klasör" kaydını yeni kaynak modeline taşı
      if (srcs.length === 0) {
        const legacy = await getLastDirHandle()
        if (legacy) {
          const record = {
            id: `src-legacy-${Date.now()}`,
            label: legacy.name,
            addedAt: Date.now(),
            handle: legacy,
          }
          await putSource(record)
          srcs.push(record)
          setError(
            `"${legacy.name}" klasörü önceki oturumdan aktarıldı. ` +
              'İşaretleri geri getirmek için üstteki çipten "Bağlan"a tıkla; ' +
              'önbellek sayesinde hızlı yüklenecek.',
          )
        }
      }

      const granted = new Set<string>()
      await Promise.all(
        srcs.map(async (s) => {
          if (!s.handle) return
          handlesRef.current.set(s.id, s.handle)
          if (await isSourceAvailable(s.handle)) granted.add(s.id)
        }),
      )
      const loaded: MediaItem[] = lib.map((l) => ({
        id: l.id,
        name: l.name,
        relativePath: l.relativePath,
        sourceId: l.sourceId,
        kind: l.kind,
        available: granted.has(l.sourceId),
        latitude: l.latitude,
        longitude: l.longitude,
        takenAt: l.takenAt ? new Date(l.takenAt) : undefined,
        width: l.width,
        height: l.height,
        // Eski kayıtlarda bayrak yoktu; 0,0 koordinatı konum yok demektir.
        locationMissing: l.locationMissing ?? isNullIslandCoordinate(l.latitude, l.longitude),
        gpsExtractFailed: l.gpsExtractFailed,
      }))

      // Eski sürücü kayıtları: medya çapa id'sinde kalmış → alt klasör çocuklarına böl
      // Case-dup (MISC/misc) ve kayıp çapa kurtarma burada yapılır.
      let uiSources: SourceUi[] = recoverMissingAnchors(
        srcs
          .map((s) => ({
            id: s.id,
            label: s.label,
            addedAt: s.addedAt,
            parentId: s.parentId,
            subPath: s.subPath,
            localPath: s.localPath,
            isAnchor: s.isAnchor ?? isDriveRootPath(s.localPath),
            directOnly: s.directOnly,
          }))
          .sort((a, b) => a.addedAt - b.addedAt),
      )

      // Aynı harfte çift çapa (E: kurtarıldı + E: Elements) → tekilleştir
      const mergedAnchors = mergeDuplicateDriveAnchors(uiSources)
      uiSources = mergedAnchors.sources

      let uiItems = loaded
      if (mergedAnchors.idMap.size > 0) {
        const remappedLib: MediaItem[] = []
        uiItems = uiItems.map((item) => {
          const to = mergedAnchors.idMap.get(item.sourceId)
          if (!to || to === item.sourceId) return item
          const next = rewriteItemSource(
            item,
            to,
            item.relativePath || item.name,
          )
          remappedLib.push(next)
          return next
        })
        if (remappedLib.length > 0) {
          await putLibraryItems(remappedLib.map(toLibraryItem))
        }
        for (const [from, to] of mergedAnchors.idMap) {
          if (from === to) continue
          await deleteLibraryItemsBySource(from)
        }
        for (const rid of mergedAnchors.removedIds) {
          await deleteSource(rid)
          handlesRef.current.delete(rid)
        }
      }

      for (const source of uiSources) {
        const prev = srcs.find((s) => s.id === source.id)
        if (
          !prev ||
          prev.parentId !== source.parentId ||
          prev.subPath !== source.subPath ||
          prev.localPath !== source.localPath ||
          Boolean(prev.isAnchor) !== Boolean(source.isAnchor) ||
          prev.label !== source.label
        ) {
          await putSource({
            id: source.id,
            label: source.label,
            addedAt: source.addedAt,
            localPath: source.localPath,
            parentId: source.parentId,
            subPath: source.subPath,
            isAnchor: source.isAnchor,
            directOnly: source.directOnly,
          })
        }
      }
      for (const anchor of [...uiSources]) {
        if (!anchor.isAnchor && !isDriveRootPath(anchor.localPath)) continue
        const rootPath =
          anchor.localPath ?? localPathForSource(anchor, uiSources)
        if (!rootPath || !isDriveRootPath(rootPath)) continue

        const underDrive = uiItems.filter(
          (i) => itemDriveRelativePath(i, anchor.id, uiSources) != null,
        )
        const onAnchor = uiItems.filter((i) => i.sourceId === anchor.id)
        const seedItems = underDrive.length > 0 ? underDrive : onAnchor
        const existingKids = uiSources.filter(
          (s) => s.parentId === anchor.id && s.subPath != null,
        )
        if (seedItems.length === 0 && existingKids.length === 0) continue

        // Klasör yolları: case koru — itemDriveRelativePath ile küçük harfe çevirme
        const folderPaths =
          seedItems.length > 0
            ? mediaFolderSubPaths(
                seedItems.map((item) => {
                  const rel =
                    itemPathUnderRoot(item, uiSources, anchor.id) ??
                    (item.relativePath || item.name).replaceAll('\\', '/')
                  return { ...item, relativePath: rel, sourceId: anchor.id }
                }),
              )
            : existingKids.map((k) => k.subPath as string)

        const bySubNorm = new Map(
          existingKids.map((s) => [normalizeRelPath(s.subPath as string), s]),
        )
        const childSources: SourceUi[] = []
        const seenNorm = new Set<string>()
        for (const subPath of folderPaths) {
          const key = normalizeRelPath(subPath)
          if (seenNorm.has(key)) continue
          seenNorm.add(key)
          const childPath =
            subPath === ''
              ? `${rootPath.replace(/[\\/]+$/, '')}\\`
              : `${rootPath.replace(/[\\/]+$/, '')}\\${subPath.replaceAll('/', '\\')}`
          const prev = bySubNorm.get(key)
          if (prev) {
            const prefer =
              casingScore(prev.subPath ?? '') >= casingScore(subPath)
                ? (prev.subPath ?? subPath)
                : subPath
            childSources.push({
              ...prev,
              localPath: childPath,
              subPath: prefer,
              isAnchor: false,
            })
            continue
          }
          childSources.push({
            id: `src-mig-${anchor.id}-${childSources.length}-${Date.now().toString(36)}`,
            label:
              subPath === ''
                ? '(kök)'
                : subPath.split('/').filter(Boolean).pop() || subPath,
            addedAt: Date.now(),
            localPath: childPath,
            parentId: anchor.id,
            subPath,
            directOnly: true,
          })
        }

        for (const kid of existingKids) {
          const key = normalizeRelPath(kid.subPath ?? '')
          if (seenNorm.has(key)) continue
          seenNorm.add(key)
          childSources.push(kid)
        }

        const { kept: uniqueChildren, idMap } = dedupeChildrenBySubPath(childSources)
        if ([...idMap].some(([from, to]) => from !== to)) {
          uiItems = uiItems.map((item) => {
            const to = idMap.get(item.sourceId)
            if (!to || to === item.sourceId) return item
            return rewriteItemSource(item, to, item.relativePath || item.name)
          })
          for (const [from, to] of idMap) {
            if (from !== to) await deleteSource(from)
          }
        }

        const sourcesForRemap = [
          ...uiSources.filter(
            (s) => s.id === anchor.id || s.parentId !== anchor.id,
          ),
          ...uniqueChildren,
        ]
        const remapped = remapAllItemsUnderDrive(
          uiItems,
          anchor.id,
          uniqueChildren.map((c) => ({ id: c.id, subPath: c.subPath ?? '' })),
          sourcesForRemap,
        )
        uiItems = remapped
        uiSources = [
          ...uiSources.filter(
            (s) =>
              s.id === anchor.id ||
              s.parentId !== anchor.id ||
              uniqueChildren.some((c) => c.id === s.id),
          ),
          ...uniqueChildren.filter((c) => !uiSources.some((s) => s.id === c.id)),
        ]
        uiSources = uiSources.map((s) => {
          const fresh = uniqueChildren.find((c) => c.id === s.id)
          return fresh
            ? { ...s, localPath: fresh.localPath, subPath: fresh.subPath }
            : s
        })

        await deleteLibraryItemsBySource(anchor.id)
        for (const child of uniqueChildren) {
          await putSource({
            id: child.id,
            label: child.label,
            addedAt: child.addedAt,
            localPath: child.localPath,
            parentId: anchor.id,
            subPath: child.subPath,
            directOnly: true,
          })
        }
        await putSource({
          id: anchor.id,
          label: anchor.label,
          addedAt: anchor.addedAt,
          localPath: rootPath,
          isAnchor: true,
        })
        await putLibraryItems(
          remapped
            .filter(
              (i) =>
                uniqueChildren.some((c) => c.id === i.sourceId) ||
                i.sourceId === anchor.id,
            )
            .map(toLibraryItem),
        )
        for (const child of uniqueChildren) granted.add(child.id)
      }

      // Sürücü altında kalan yetim kökleri kaldır (PANORAMA / GoPro kopyaları)
      {
        const anchors = uiSources.filter((s) => s.isAnchor)
        const removeOrphans = new Set<string>()
        for (const s of uiSources) {
          if (s.isAnchor || s.parentId) continue
          const path = (
            localPathForSource(s, uiSources) ??
            s.localPath ??
            ''
          )
            .replace(/\//g, '\\')
            .replace(/[\\/]+$/, '')
            .toLowerCase()
          for (const anchor of anchors) {
            const root = (
              localPathForSource(anchor, uiSources) ??
              anchor.localPath ??
              ''
            )
              .replace(/\//g, '\\')
              .replace(/[\\/]+$/, '')
              .toLowerCase()
            if (!root) continue
            if (path && (path === root || path.startsWith(`${root}\\`))) {
              removeOrphans.add(s.id)
              break
            }
          }
          // Yolsuz ve medyasız yetim
          if (
            !path &&
            !uiItems.some((i) => i.sourceId === s.id) &&
            !uiSources.some((c) => c.parentId === s.id)
          ) {
            removeOrphans.add(s.id)
          }
        }
        if (removeOrphans.size > 0) {
          for (const rid of removeOrphans) {
            void deleteSource(rid)
            // Medya sürücü çocuklarına taşındıysa silme; yalnızca kaynak kaydı kalksın
            handlesRef.current.delete(rid)
          }
          uiSources = uiSources.filter((s) => !removeOrphans.has(s.id))
          // Hâlâ yetim id’de kalan medyayı sürücüye yeniden yaz
          for (const anchor of anchors) {
            const kids = uiSources.filter(
              (c) => c.parentId === anchor.id && c.subPath != null,
            )
            if (kids.length === 0) continue
            uiItems = remapAllItemsUnderDrive(
              uiItems,
              anchor.id,
              kids.map((c) => ({ id: c.id, subPath: c.subPath ?? '' })),
              uiSources,
            )
          }
        }
      }

      // Gizli listeden silinmiş kaynak id’lerini temizle (aksi halde Gösterilen 0 kalır)
      {
        const validIds = new Set(uiSources.map((s) => s.id))
        const prevHidden = loadHiddenSources()
        let pruned = [...prevHidden].filter((id) => validIds.has(id))
        // Tüm kaynaklar gizliyse otomatik aç — kullanıcı yanlışlıkla hepsini kapatmış olabilir
        if (validIds.size > 0 && pruned.length === validIds.size) {
          pruned = []
        }
        if (pruned.length !== prevHidden.size) {
          const next = new Set(pruned)
          localStorage.setItem(HIDDEN_SOURCES_KEY, JSON.stringify([...next]))
          if (!cancelled) setHiddenSourceIds(next)
        }
      }

      if (cancelled) return

      setSources(uiSources)
      // Sürücü alt klasörleri görünsün
      const expand = new Set<string>()
      for (const anchor of uiSources.filter((s) => s.isAnchor)) {
        const kids = uiSources.filter((s) => s.parentId === anchor.id)
        for (const key of expandKeysForDriveChildren(anchor.id, kids)) {
          expand.add(key)
        }
      }
      setExpandedTree(expand)
      setSourcesOpen(uiSources.length === 0 && uiItems.length === 0)
      setGrantedIds(granted)
      setItems(uiItems)

      let alreadyDismissed = false
      try {
        alreadyDismissed = sessionStorage.getItem(SESSION_RESUME_KEY) === '1'
      } catch {
        /* private mode */
      }
      if (
        uiItems.length > 0 &&
        !cancelled &&
        !sessionResumeHandledRef.current &&
        !alreadyDismissed
      ) {
        sessionResumeHandledRef.current = true
        const driveCount = uiSources.filter((s) => s.isAnchor).length
        setSessionResume({
          itemCount: uiItems.length,
          driveCount,
          sourceCount:
            driveCount > 0
              ? driveCount
              : uiSources.filter((s) => !s.isAnchor).length || uiSources.length,
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const cancelScan = useCallback(() => {
    for (const controller of scanControllersRef.current.values()) {
      controller.abort()
    }
    scanControllersRef.current.clear()
    for (const jobId of scanJobIdsRef.current.values()) {
      void fetch(`/api/scan/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }).catch(
        () => {},
      )
    }
    scanJobIdsRef.current.clear()
    setScans(new Map())
    setError('Tarama iptal edildi.', 'info')
  }, [])

  const toggleSourceVisible = useCallback((id: string) => {
    setHiddenSourceIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(HIDDEN_SOURCES_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  const toggleKind = useCallback((kind: MediaKind) => {
    setEnabledKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) {
        // Harita ve tarama hiçbir tür seçilmeden bırakılamaz.
        if (next.size === 1) return current
        next.delete(kind)
      } else {
        next.add(kind)
      }
      localStorage.setItem(FILTER_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  const resolveFile = useCallback(
    async (item: MediaItem): Promise<File | null> => {
      let file = fileMapRef.current.get(item.id)
      if (!file) {
        const handle = handlesRef.current.get(item.sourceId)
        if (!handle) return null
        const ok = await ensureReadPermission(handle, true)
        if (!ok) return null
        const resolved = await resolveFileFromHandle(handle, item.relativePath)
        if (!resolved) return null
        file = resolved
        fileMapRef.current.set(item.id, file)
      }
      return file
    },
    [],
  )

  const resolveUrl = useCallback(
    async (item: MediaItem): Promise<string | null> => {
      const cached = urlCacheRef.current.get(item.id)
      if (cached) return cached

      // Video Range için doğrudan API (CORS sunucuda); proxy tamponu takılmasın
      const toMediaUrl = (url: string) =>
        url.startsWith('/api/') ? `http://127.0.0.1:5174${url}` : url

      const { rootPath, relativePath } = apiPathsForItem(item, sourcesRef.current)
      if (rootPath) {
        try {
          const response = await fetch('/api/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: item.id,
              rootPath,
              relativePath,
            }),
          })
          const data = (await response.json()) as { url?: string }
          if (response.ok && data.url) {
            const mediaUrl = toMediaUrl(data.url)
            urlCacheRef.current.set(item.id, mediaUrl)
            return mediaUrl
          }
        } catch { /* tarayıcı dosya yolu çözümüne düş */ }
      }

      // Blob / http dışı sabit url'ler (eski tarayıcı akışı)
      if (item.url && !item.url.startsWith('/api/media/')) {
        urlCacheRef.current.set(item.id, item.url)
        return item.url
      }

      const file = await resolveFile(item)
      if (!file) {
        if (item.url) {
          const fallback = toMediaUrl(item.url)
          urlCacheRef.current.set(item.id, fallback)
          return fallback
        }
        return null
      }
      const url = URL.createObjectURL(file)
      urlCacheRef.current.set(item.id, url)
      return url
    },
    [resolveFile],
  )

  const revealInFolder = useCallback(
    async (item: MediaItem): Promise<boolean> => {
      try {
        const { rootPath, relativePath, builtPath } = apiPathsForItem(
          item,
          sourcesRef.current,
        )

        if (!rootPath && !builtPath) {
          setError(
            'Bu medyanın disk yolu yok. Kaynağı “+ Sürücü ekle” ile ekle veya yolu yaz.',
          )
          return false
        }

        // Önce resolve ile media cache’i ısıt
        if (rootPath) {
          try {
            await fetch('/api/resolve', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: item.id,
                rootPath,
                relativePath,
              }),
            })
          } catch {
            /* reveal yine dener */
          }
        }

        const response = await fetch('/api/reveal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: item.id,
            path: builtPath,
            rootPath,
            relativePath,
          }),
        })
        const data = (await response.json().catch(() => null)) as {
          selected?: boolean
          path?: string
          folder?: string
          error?: string
        } | null
        if (!response.ok) {
          setError(
            data?.error ||
              'Klasör açılamadı. Kaynağı sürücü yolu ile eklediğinden emin ol.',
          )
          return false
        }
        if (data?.path) {
          setError(
            data.selected
              ? `Explorer’da seçildi: ${data.path}`
              : `Explorer: ${data.path}`,
            'info',
          )
        }
        return Boolean(data?.path || response.ok)
      } catch {
        setError('Klasör açılamadı. baslat-v2.bat / yerel API çalışıyor mu?')
        return false
      }
    },
    [setError],
  )

  /** Kaynak klasörünü Windows Explorer’da aç. */
  const openSourceInExplorer = useCallback(
    async (source: SourceUi, folderPath?: string) => {
      let path =
        (folderPath && folderPath.trim()) ||
        localPathForSource(source, sourcesRef.current) ||
        source.localPath
      if (!path) {
        setError(
          'Bu kaynağın disk yolu yok. Tarayıcı klasör izni (FSA) Explorer açamaz — “+ Sürücü ekle” veya klasör seçici kullanın.',
        )
        return false
      }
      // Windows: E: → E:\; gereksiz trailing \ (kök hariç) temizle
      path = path.replace(/\//g, '\\')
      if (/^[a-zA-Z]:$/.test(path)) path = `${path}\\`
      else if (!/^[a-zA-Z]:\\$/i.test(path)) path = path.replace(/[\\/]+$/, '')
      try {
        const response = await fetch('/api/reveal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        })
        const data = (await response.json().catch(() => null)) as {
          ok?: boolean
          path?: string
          error?: string
          missingOnDisk?: boolean
        } | null
        if (!response.ok) {
          setError(
            data?.error ||
              'Klasör Explorer’da açılamadı (yol veya yerel API).',
          )
          return false
        }
        if (data?.missingOnDisk) {
          setError(
            `Explorer açıldı ama yol şu an erişilemiyor: ${data.path || path}`,
          )
        } else {
          setError(`Explorer: ${data?.path || path}`, 'info')
        }
        return true
      } catch {
        setError('Klasör açılamadı. baslat-v2.bat / yerel API çalışıyor mu?')
        return false
      }
    },
    [setError],
  )

  const playExternally = useCallback(
    async (
      item: MediaItem,
      player: 'system' | 'vlc' | 'wmplayer' = 'system',
    ): Promise<boolean> => {
      try {
        const { rootPath, relativePath, builtPath } = apiPathsForItem(
          item,
          sourcesRef.current,
        )
        if (!builtPath && !rootPath) return false
        const response = await fetch('/api/play', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: builtPath,
            id: item.id,
            player,
            rootPath,
            relativePath,
          }),
        })
        const data = (await response.json().catch(() => null)) as {
          ok?: boolean
          error?: string
        } | null
        if (!response.ok || data?.ok === false) return false
        return true
      } catch {
        return false
      }
    },
    [],
  )

  const stopPreview = useCallback(async () => {
    try {
      await fetch('/api/preview/stop', { method: 'POST' })
    } catch {
      /* yok say */
    }
  }, [])

  /**
   * Küçük önizleme: önce bellek, sonra IndexedDB; yoksa dosyadan bir kez
   * üretilir ve kalıcı saklanır. Galeri asla tam boy video/foto açmaz.
   */
  const pathForItem = useCallback(
    (item: MediaItem): string => {
      const source = sourcesRef.current.find((s) => s.id === item.sourceId)
      if (!source) return item.relativePath || item.name

      const parts: string[] = []
      if (source.parentId) {
        const drive = sourcesRef.current.find((s) => s.id === source.parentId)
        if (drive) parts.push(drive.label)
      } else if (source.isAnchor) {
        parts.push(source.label)
      } else {
        parts.push(source.label)
      }

      if (source.subPath) parts.push(...source.subPath.split('/').filter(Boolean))

      const rel = item.relativePath || item.name
      const relParts = rel.split('/').filter(Boolean)
      // Klasör adı zaten subPath'te varsa dosya adını ekle; göreli yol klasör+dosya ise ekle
      if (relParts.length > 0) {
        const last = relParts[relParts.length - 1]
        if (relParts.length === 1) {
          parts.push(last)
        } else {
          parts.push(...relParts)
        }
      }

      // Yinelenen ardışık parçaları sadeleştir
      const clean: string[] = []
      for (const p of parts) {
        if (clean[clean.length - 1] !== p) clean.push(p)
      }
      return clean.join(' › ')
    },
    [],
  )

  const copyItemPath = useCallback(
    (item: MediaItem) => {
      const text = pathForItem(item)
      void navigator.clipboard.writeText(text).then(
        () => setError(`Yol kopyalandı: ${text}`, 'info'),
        () => setError('Yol kopyalanamadı.'),
      )
    },
    [pathForItem],
  )

  /**
   * Küçük önizleme: bellek → IndexedDB → masaüstü /api/thumb → tarayıcı dosyası.
   * Disk önbelleği kararlı anahtarla (mtime yok) — her taramada yeniden üretilmez.
   */
  const resolveThumb = useCallback(
    async (item: MediaItem): Promise<ThumbInfo | null> => {
      const cacheKey = stableThumbKey(item)
      const inMemory = thumbCacheRef.current.get(cacheKey)
      if (inMemory) return inMemory

      const pending = thumbPendingRef.current.get(cacheKey)
      if (pending) return pending

      const toDirect = (url: string) =>
        url.startsWith('/api/') ? `http://127.0.0.1:5174${url}` : url

      const task = (async (): Promise<ThumbInfo | null> => {
        const stored = await getThumb(cacheKey).catch(() => null)
        if (stored) {
          const info: ThumbInfo = {
            url: URL.createObjectURL(stored.blob),
            durationSec: stored.durationSec,
          }
          thumbCacheRef.current.set(cacheKey, info)
          return info
        }

        const { rootPath, relativePath } = apiPathsForItem(
          item,
          sourcesRef.current,
        )

        if (rootPath && item.kind === 'photo') {
          const directUrl = await resolveUrl(item)
          if (directUrl) {
            const info = { url: directUrl }
            thumbCacheRef.current.set(cacheKey, info)
            return info
          }
        }

        if (rootPath) {
          await acquireThumbFetch()
          try {
            const response = await fetch('/api/thumb', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: item.id,
                rootPath,
                relativePath,
              }),
            })
            const data = (await response.json()) as { url?: string; durationSec?: number; cached?: boolean }
            if (response.ok && data.url) {
              const info: ThumbInfo = {
                url: toDirect(data.url),
                durationSec: data.durationSec,
              }
              thumbCacheRef.current.set(cacheKey, info)
              return info
            }
          } catch { /* tarayıcı yoluna düş */ }
          finally {
            releaseThumbFetch()
          }
        }

        if (item.url && item.kind === 'photo') {
          const info = { url: toDirect(item.url) }
          thumbCacheRef.current.set(cacheKey, info)
          return info
        }

        const directUrl = item.kind === 'photo' ? await resolveUrl(item) : null
        if (directUrl) {
          const info = { url: directUrl }
          thumbCacheRef.current.set(cacheKey, info)
          return info
        }

        const file = await resolveFile(item)
        if (!file) return null

        const generated = await generateThumb(file, item.kind)
        if (!generated) return null

        await putThumb({
          id: cacheKey,
          blob: generated.blob,
          durationSec: generated.durationSec,
        }).catch(() => {
          /* telefon IndexedDB kapanırsa önbelleksiz devam */
        })
        const info: ThumbInfo = {
          url: URL.createObjectURL(generated.blob),
          durationSec: generated.durationSec,
        }
        thumbCacheRef.current.set(cacheKey, info)
        return info
      })().catch(() => null)

      thumbPendingRef.current.set(cacheKey, task)
      try {
        return await task
      } finally {
        thumbPendingRef.current.delete(cacheKey)
      }
    },
    [resolveFile, resolveUrl],
  )

  const ingest = useCallback(
    async (files: FileList | File[] | null, sourceId: string, persist: boolean) => {
      const list = files ? (Array.isArray(files) ? files : Array.from(files)) : []
      if (list.length === 0) return
      const scanKinds = new Set(enabledKindsRef.current)

      const trackFiles = list.filter((f) => isTrackFileName(f.name))
      const mediaList = list.filter((f) => !isTrackFileName(f.name))

      if (trackFiles.length > 0) {
        const parsed: MapTrack[] = []
        for (const file of trackFiles) {
          const track = await parseTrackFile(file, sourceId)
          if (track) parsed.push(track)
        }
        if (parsed.length > 0) {
          setTracks((prev) => [...prev, ...parsed])
          setRidesOpen(true)
          setError(`${parsed.length} ride dosyası eklendi.`, 'info')
        } else if (mediaList.length === 0) {
          setError('GPX/KML/KMZ okunamadı veya yeterli nokta yok.')
          return
        }
      }

      if (mediaList.length === 0) return

      // Aynı kaynak yeniden taranıyorsa eskisini durdur; farklı kaynaklar
      // birbirinden bağımsız, eşzamanlı taranır.
      scanControllersRef.current.get(sourceId)?.abort()
      const controller = new AbortController()
      scanControllersRef.current.set(sourceId, controller)
      // Bu tarama, yerine yenisi başlamadığı sürece kendi ilerlemesini yönetir.
      const isCurrent = () =>
        scanControllersRef.current.get(sourceId) === controller

      setError(null)
      setScans((prev) =>
        new Map(prev).set(sourceId, { done: 0, total: mediaList.length }),
      )
      try {
        const {
          items: next,
          files: freshFiles,
          skipped: miss,
          skippedNames: missNames,
          mediaCount,
          ignoredCount,
          cachedCount: cached,
        } = await scanFiles(
          mediaList,
          sourceId,
          (done, total, located, missing) => {
            if (isCurrent()) {
              setScans((prev) =>
                new Map(prev).set(sourceId, {
                  done,
                  total,
                  located: located ?? 0,
                  missing: missing ?? 0,
                }),
              )
            }
          },
          controller.signal,
          true,
          scanKinds,
        )

        for (const [id, file] of freshFiles) fileMapRef.current.set(id, file)

        if (persist) {
          // Tam taramada kaynağı yenile; tür filtresi açıksa diğer türlerin
          // daha önceki kütüphane kayıtlarını koru.
          if (scanKinds.size === ALL_KINDS.length) {
            await deleteLibraryItemsBySource(sourceId)
          } else {
            const oldSelectedIds = itemsRef.current
              .filter((i) => i.sourceId === sourceId && scanKinds.has(i.kind))
              .map((i) => i.id)
            await deleteLibraryItems(oldSelectedIds)
          }
          await putLibraryItems(next.map(toLibraryItem))
        }

        // Aynı kaynağın eski URL'lerini serbest bırak, öğeleri değiştir
        for (const [id, url] of urlCacheRef.current) {
          if (id.startsWith(`${sourceId}|`)) {
            URL.revokeObjectURL(url)
            urlCacheRef.current.delete(id)
          }
        }

        const nextIds = new Set(next.map((i) => i.id))
        setItems((prev) => [
          ...prev.filter(
            (i) =>
              !nextIds.has(i.id) &&
              (i.sourceId !== sourceId || !scanKinds.has(i.kind)),
          ),
          ...next,
        ])
        setGrantedIds((prev) => new Set(prev).add(sourceId))
        setSkipped(miss)
        setSkippedNames(missNames)
        setCachedCount(cached)
        setViewer(null)

        if (next.length === 0) {
          if (mediaCount === 0) {
            setError(
              ignoredCount > 0
                ? `${ignoredCount} dosya bulundu ama hiç foto/video/GoPro yok.`
                : 'Seçilen klasörde medya dosyası yok.',
            )
          }
        } else {
          setError(
            `${next.length} medya eklendi (GPS yok). Konum için Sürücü ekle / klasör yolu ile tara (Konum Bulucu).`,
            'info',
          )
        }
      } catch (e) {
        if (e instanceof ScanAbortedError) {
          // Aynı kaynak için yeni tarama başladıysa sessiz kal; sadece
          // kullanıcı İptal'e bastıysa bildir.
          if (isCurrent()) setError('Okuma iptal edildi.')
        } else if (isCurrent()) {
          setError(friendlyError(e, 'Dosyalar okunamadı.'))
        }
      } finally {
        if (isCurrent()) {
          scanControllersRef.current.delete(sourceId)
          setScans((prev) => {
            const next = new Map(prev)
            next.delete(sourceId)
            return next
          })
        }
      }
    },
    [],
  )

  const addFolder = useCallback(async () => {
    if (!canPickFolder()) {
      folderInputRef.current?.click()
      return
    }
    try {
      const handle = await pickFolderHandle()
      if (handle === null) {
        folderInputRef.current?.click()
        return
      }
      if (handle === 'cancelled') return
      // Başlangıçta kapalı kalsın; yeni kaynak eklenirken tarama ilerlemesi
      // görünür olmalı.
      setSourcesOpen(true)

      // 1) Birebir aynı klasör zaten ekliyse kopya oluşturma: yeniden tara
      for (const [id, h] of handlesRef.current) {
        if (await isSameFolder(h, handle)) {
          setError('Bu klasör zaten ekli; yeniden taranıyor.')
          const files = await readFilesFromHandle(handle, (name) =>
            acceptsFileName(name, enabledKindsRef.current),
          )
          await ingest(files, id, true)
          return
        }
      }

      // 1b) Yerel sürücü / alt klasörlerle çakışma (yol + medya yolu)
      const nameLower = handle.name.toLowerCase()
      for (const source of sourcesRef.current) {
        const existing =
          localPathForSource(source, sourcesRef.current) ?? source.localPath
        if (existing) {
          const leaf = existing
            .replace(/[\\/]+$/, '')
            .split(/[\\/]/)
            .pop()
            ?.toLowerCase()
          if (leaf === nameLower) {
            setError(
              `“${handle.name}” zaten “${source.label}” olarak yüklü` +
                (source.parentId || source.isAnchor
                  ? ' (sürücü taramasında). Ayrı ekleme.'
                  : '.'),
            )
            return
          }
        }
        if (source.subPath) {
          const parts = source.subPath.split('/').map((p) => p.toLowerCase())
          if (parts.includes(nameLower)) {
            const parent = sourcesRef.current.find((s) => s.id === source.parentId)
            setError(
              `“${handle.name}” zaten “${parent?.label ?? 'sürücü'}” altında yüklü` +
                ` (${source.subPath.replaceAll('/', '\\')}).`,
            )
            return
          }
        }
      }
      for (const anchor of sourcesRef.current.filter((s) => s.isAnchor)) {
        const related = new Set(
          sourcesRef.current
            .filter((s) => s.id === anchor.id || s.parentId === anchor.id)
            .map((s) => s.id),
        )
        for (const item of itemsRef.current) {
          if (!related.has(item.sourceId)) continue
          const rel = (item.relativePath || item.name)
            .replaceAll('\\', '/')
            .toLowerCase()
          if (rel.split('/').includes(nameLower)) {
            setError(
              `“${handle.name}” zaten “${anchor.label}” sürücü taramasında var. ` +
                'Kaynaklar listesinde sürücünün alt klasörlerine bak.',
            )
            return
          }
        }
      }

      // 2) Mevcut kaynaklarla ilişki: çapa altına yerleşir,
      //    taranmış kaynak kapsamındaysa mükerrer veri olmasın diye eklenmez
      let parentId: string | undefined
      let subPath: string | undefined
      for (const source of sourcesRef.current) {
        const h = handlesRef.current.get(source.id)
        if (!h) continue
        const rel = await relativePathIfDescendant(h, handle)
        if (!rel) continue
        if (source.isAnchor) {
          // En derin (en yakın) çapayı seç
          if (!subPath || rel.length < subPath.split('/').length) {
            parentId = source.id
            subPath = rel.join('/')
          }
        } else {
          setError(
            `Bu klasör zaten "${source.label}" kaynağının içinde; ` +
              'ayrıca eklemek haritada mükerrer kayıt oluşturur.',
          )
          return
        }
      }

      // 3) Yeni klasör, taranmış bir kaynağı kapsıyorsa da engelle
      for (const source of sourcesRef.current) {
        if (source.isAnchor) continue
        const h = handlesRef.current.get(source.id)
        if (!h) continue
        const rel = await relativePathIfDescendant(handle, h)
        if (rel) {
          setError(
            `Bu klasör, ekli "${source.label}" kaynağını kapsıyor. ` +
              'Mükerrer kayıt olmaması için önce onu × ile kaldır.',
          )
          return
        }
      }

      const sourceId = `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      handlesRef.current.set(sourceId, handle)
      const addedAt = Date.now()
      await putSource({
        id: sourceId,
        label: handle.name,
        addedAt,
        handle,
        parentId,
        subPath,
      })
      setSources((prev) => [
        ...prev,
        { id: sourceId, label: handle.name, addedAt, parentId, subPath },
      ])
      if (parentId) {
        setExpandedTree((prev) => {
          const next = new Set(prev)
          for (const key of expandKeysForDriveChildren(parentId, [
            {
              id: sourceId,
              label: handle.name,
              addedAt,
              parentId,
              subPath,
            },
          ])) {
            next.add(key)
          }
          return next
        })
      }

      setGrantedIds((prev) => new Set(prev).add(sourceId))
      const files = await readFilesFromHandle(handle, (name) =>
        acceptsFileName(name, enabledKindsRef.current),
      )
      await ingest(files, sourceId, true)
    } catch (e) {
      setError(friendlyError(e, 'Klasör eklenemedi.'))
    }
  }, [ingest])

  const scanLocalPath = useCallback(async (
    existingPath?: string,
    existingId?: string,
    preferredLabel?: string,
    options?: { forceGoProRetry?: boolean },
  ) => {
    if (!existingPath?.trim()) {
      setError('Sürücü yolu kayıtlı değil. Kaynağı kaldırıp “+ Sürücü ekle” ile yeniden ekle.')
      return
    }
    const path = existingPath.trim()
    let sourceId = existingId ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // Sürücü kökü taranıyorsa id her zaman çapa olmalı — "(kök)" çocuğu değil
    if (isDriveRootPath(path) && existingId) {
      const self = sourcesRef.current.find((s) => s.id === existingId)
      if (self?.parentId && (self.subPath === '' || self.subPath == null)) {
        sourceId = self.parentId
      } else if (self && !self.isAnchor && self.parentId) {
        const parent = sourcesRef.current.find((s) => s.id === self.parentId)
        if (parent?.isAnchor) sourceId = parent.id
      }
    }
    const label =
      preferredLabel?.trim()
      || sourcesRef.current.find((s) => s.id === sourceId)?.label
      || path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop()
      || path

    // Yol çakışması: aynı / kapsayan / kapsanan kaynak
    if (!existingId) {
      for (const source of sourcesRef.current) {
        const existing =
          localPathForSource(source, sourcesRef.current) ?? source.localPath
        if (!existing) continue
        if (pathEqualsOrInside(path, existing)) {
          if (normalizeWinPath(path) === normalizeWinPath(existing)) {
            setError(
              `“${source.label}” zaten ekli. Yeniden taramak için listedeki ↻ düğmesini kullan.`,
            )
            return
          }
          setError(
            `Bu klasör zaten “${source.label}” içinde yüklü` +
              (source.isAnchor || isDriveRootPath(existing)
                ? ' (sürücü taraması onu kapsıyor).'
                : '. Ayrı eklemek mükerrer kayıt oluşturur.'),
          )
          return
        }
        if (
          !source.isAnchor &&
          pathEqualsOrInside(existing, path) &&
          !isDriveRootPath(path)
        ) {
          setError(
            `Bu yol, ekli “${source.label}” kaynağını kapsıyor. ` +
              'Önce onu × ile kaldır veya sürücü olarak ekle.',
          )
          return
        }
      }
    }

    // Sürücü eklenirken altındaki elle eklenmiş klasörleri temizle (yeniden çocuk olacak)
    let absorbedCount = 0
    if (isDriveRootPath(path) && !existingId) {
      const absorb = sourcesRef.current.filter((source) => {
        if (source.isAnchor || source.id === sourceId) return false
        const existing =
          localPathForSource(source, sourcesRef.current) ?? source.localPath
        return Boolean(existing && pathEqualsOrInside(existing, path))
      })
      if (absorb.length > 0) {
        absorbedCount = absorb.length
        const removeIds = new Set(absorb.map((s) => s.id))
        for (const rid of removeIds) {
          void deleteSource(rid)
          void deleteLibraryItemsBySource(rid)
          handlesRef.current.delete(rid)
        }
        setSources((prev) => prev.filter((s) => !removeIds.has(s.id)))
        setItems((prev) => prev.filter((i) => !removeIds.has(i.sourceId)))
        setGrantedIds((prev) => {
          const next = new Set(prev)
          for (const rid of removeIds) next.delete(rid)
          return next
        })
      }
    }

    setError(null)
    setSourcesOpen(false)
    setDriveDialogOpen(false)
    // Tarama başlarken kaynağı bağlı say — kırmızı “Disk bağlı değil” olmasın
    setGrantedIds((prev) => new Set(prev).add(sourceId))
    setLocalOnlineIds((prev) => new Set(prev).add(sourceId))
    setLocalAvailabilityReady(true)
    setScans((prev) => new Map(prev).set(sourceId, { done: 0, total: 0 }))
    scanControllersRef.current.get(sourceId)?.abort()
    const controller = new AbortController()
    scanControllersRef.current.set(sourceId, controller)
    const signal = controller.signal
    // Kaynak hemen listede görünsün
    const startedAt = Date.now()
    setSources((prev) => {
      if (existingId || prev.some((s) => s.id === sourceId)) {
        return prev.map((s) =>
          s.id === sourceId
            ? { ...s, label, localPath: path, isAnchor: isDriveRootPath(path) || s.isAnchor }
            : s,
        )
      }
      return [
        ...prev,
        {
          id: sourceId,
          label,
          localPath: path,
          addedAt: startedAt,
          isAnchor: isDriveRootPath(path),
        },
      ]
    })
    // Çapayı hemen kaydet — tarama yarıda kalsa bile çocuklar yetim kalmasın
    void putSource({
      id: sourceId,
      label,
      addedAt:
        sourcesRef.current.find((s) => s.id === sourceId)?.addedAt ?? startedAt,
      localPath: path,
      isAnchor: isDriveRootPath(path),
      parentId: sourcesRef.current.find((s) => s.id === sourceId)?.parentId,
      subPath: sourcesRef.current.find((s) => s.id === sourceId)?.subPath,
      directOnly: sourcesRef.current.find((s) => s.id === sourceId)?.directOnly,
    })
    sourcesRef.current = (() => {
      const prev = sourcesRef.current
      if (existingId || prev.some((s) => s.id === sourceId)) {
        return prev.map((s) =>
          s.id === sourceId
            ? {
                ...s,
                label,
                localPath: path,
                isAnchor: isDriveRootPath(path) || s.isAnchor,
              }
            : s,
        )
      }
      return [
        ...prev,
        {
          id: sourceId,
          label,
          localPath: path,
          addedAt: startedAt,
          isAnchor: isDriveRootPath(path),
        },
      ]
    })()

    // Yeniden tarama: fark birleştirme (tüm datayı sıfırlama). Yol anahtarıyla eşle.
    const existingForScan = sourcesRef.current.find((s) => s.id === sourceId)
    const parentForScan = existingForScan?.parentId
      ? sourcesRef.current.find((s) => s.id === existingForScan.parentId)
      : undefined
    const parentPath =
      parentForScan
        ? localPathForSource(parentForScan, sourcesRef.current) ?? parentForScan.localPath
        : undefined
    const isDriveChildScan = Boolean(
      !isDriveRootPath(path) &&
        existingForScan?.parentId &&
        existingForScan.subPath != null &&
        parentForScan &&
        (parentForScan.isAnchor || isDriveRootPath(parentPath)),
    )
    const driveIdForScan = isDriveChildScan
      ? existingForScan!.parentId!
      : isDriveRootPath(path)
        ? sourceId
        : null
    const pathPrefixForScan = isDriveChildScan
      ? (existingForScan!.subPath ?? '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
      : ''
    const familyIds = isDriveRootPath(path)
      ? sourceFamilyIds(sourceId, sourcesRef.current)
      : isDriveChildScan && driveIdForScan
        ? driveSubtreeSourceIds(driveIdForScan, pathPrefixForScan, sourcesRef.current)
        : new Set([sourceId])
    const pathKeyFor = (item: MediaItem): string | null => {
      if (isDriveRootPath(path)) {
        const under = itemPathUnderRoot(item, sourcesRef.current, sourceId)
        return under != null ? normalizeRelPath(under) : null
      }
      if (isDriveChildScan && driveIdForScan) {
        const underDrive = itemPathUnderRoot(
          item,
          sourcesRef.current,
          driveIdForScan,
        )
        if (underDrive == null) return null
        const underKey = normalizeRelPath(underDrive)
        const prefixKey = normalizeRelPath(pathPrefixForScan)
        if (!prefixKey) return underKey
        if (underKey === prefixKey) return ''
        if (underKey.startsWith(`${prefixKey}/`)) {
          return underKey.slice(prefixKey.length + 1)
        }
        return null
      }
      if (!familyIds.has(item.sourceId)) return null
      return normalizeRelPath(item.relativePath || item.name)
    }
    const existingByPath = new Map<string, MediaItem>()
    for (const item of itemsRef.current) {
      if (!familyIds.has(item.sourceId)) continue
      const key = pathKeyFor(item)
      if (key) existingByPath.set(key, item)
    }
    const isRescan = existingByPath.size > 0 || Boolean(existingId)

    // Sunucuya bilinen GPS'leri gönder — değişmeyen dosyada meta okuma atlanır
    const known: Record<
      string,
      {
        size: number
        mtimeMs: number
        latitude: number
        longitude: number
        locationMissing: boolean
        gpsExtractFailed?: boolean
        takenAt?: string
      }
    > = {}
    for (const [key, item] of existingByPath) {
      const parts = item.id.split('|')
      const size = Number(parts.length >= 3 ? parts[parts.length - 2] : 0)
      const mtimeMs = Number(parts.length >= 4 ? parts[parts.length - 1] : 0)
      if (!Number.isFinite(size) || !Number.isFinite(mtimeMs)) continue
      known[key] = {
        size,
        mtimeMs,
        latitude: item.latitude,
        longitude: item.longitude,
        locationMissing: Boolean(item.locationMissing),
        // Eski kayıtlarda alan yok → sunucu yeniden GPMF dener
        gpsExtractFailed: item.gpsExtractFailed,
        takenAt:
          item.takenAt instanceof Date
            ? item.takenAt.toISOString()
            : typeof item.takenAt === 'string'
              ? item.takenAt
              : undefined,
      }
    }

    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path,
          sourceId,
          known: Object.keys(known).length > 0 ? known : undefined,
          forceGoProRetry: Boolean(options?.forceGoProRetry),
        }),
        signal,
      })
      const data = await readJsonResponse<{
        error?: string
        jobId?: string
        items?: Array<Omit<MediaItem, 'takenAt'> & { takenAt?: string }>
      }>(response)
      if (!response.ok) {
        throw new Error(data.error || 'Yerel tarama başlatılamadı.')
      }
      setLocalApiAvailable(true)
      if (data.jobId) scanJobIdsRef.current.set(sourceId, data.jobId)
      const received: Array<Omit<MediaItem, 'takenAt'> & { takenAt?: string }> = []
      const seenIds = new Set<string>()
      const seenPaths = new Set<string>()

      const isDriveLiveScan = Boolean(driveIdForScan || isDriveRootPath(path))
      const liveDriveId = driveIdForScan ?? sourceId
      const liveDriveRootPath = isDriveLiveScan
        ? isDriveRootPath(path)
          ? path
          : localPathForSource(
              sourcesRef.current.find((s) => s.id === liveDriveId)!,
              sourcesRef.current,
            ) ??
            sourcesRef.current.find((s) => s.id === liveDriveId)?.localPath ??
            path
        : ''
      // Canlı taramada klasör ağacı tarama bitmeden büyüsün (büyük sürücüde 0/düz liste olmasın)
      let liveChildren: { id: string; subPath: string }[] = isDriveLiveScan
        ? sourcesRef.current
            .filter(
              (s) => s.parentId === liveDriveId && s.subPath != null,
            )
            .map((c) => ({ id: c.id, subPath: c.subPath ?? '' }))
        : []
      const liveBySubNorm = new Map(
        liveChildren.map((c) => [normalizeRelPath(c.subPath), c]),
      )

      const ensureLiveFolderSources = (driveRels: string[]) => {
        if (!isDriveLiveScan || !liveDriveRootPath) return
        const synthetic = driveRels.map((rel) => ({
          relativePath: rel,
          name: rel.split('/').pop() || rel,
        }))
        const folderPaths = mediaFolderSubPaths(
          synthetic as unknown as MediaItem[],
        )
        const added: SourceUi[] = []
        for (const subPath of folderPaths) {
          const key = normalizeRelPath(subPath)
          if (liveBySubNorm.has(key)) continue
          const childPath =
            subPath === ''
              ? `${liveDriveRootPath.replace(/[\\/]+$/, '')}\\`
              : `${liveDriveRootPath.replace(/[\\/]+$/, '')}\\${subPath.replaceAll('/', '\\')}`
          const childId = `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${liveChildren.length}`
          const childLabel =
            subPath === ''
              ? '(kök)'
              : subPath.split('/').filter(Boolean).pop() || subPath
          const child: SourceUi = {
            id: childId,
            label: childLabel,
            addedAt: Date.now(),
            localPath: childPath,
            parentId: liveDriveId,
            subPath,
            directOnly: true,
          }
          const entry = { id: childId, subPath }
          liveChildren.push(entry)
          liveBySubNorm.set(key, entry)
          added.push(child)
          void putSource({
            id: child.id,
            label: child.label,
            addedAt: child.addedAt,
            localPath: child.localPath,
            parentId: liveDriveId,
            subPath: child.subPath,
            directOnly: true,
          })
        }
        if (added.length === 0) return
        sourcesRef.current = [...sourcesRef.current, ...added]
        setSources((prev) => {
          const have = new Set(prev.map((s) => s.id))
          const next = [...prev]
          for (const child of added) {
            if (!have.has(child.id)) next.push(child)
          }
          return next
        })
        setExpandedTree((prev) => {
          const nextExpand = new Set(prev)
          for (const key of expandKeysForDriveChildren(liveDriveId, [
            ...liveChildren,
          ])) {
            nextExpand.add(key)
          }
          return nextExpand
        })
        setGrantedIds((prev) => {
          const nextGranted = new Set(prev)
          nextGranted.add(liveDriveId)
          for (const child of added) nextGranted.add(child.id)
          return nextGranted
        })
        setLocalOnlineIds((prev) => {
          const nextOnline = new Set(prev)
          nextOnline.add(liveDriveId)
          for (const child of added) nextOnline.add(child.id)
          return nextOnline
        })
        for (const child of added) familyIds.add(child.id)
      }

      const publishLive = (
        batch: Array<Omit<MediaItem, 'takenAt'> & { takenAt?: string }>,
      ) => {
        if (batch.length === 0) return
        const pending = batch.filter(
          (item) => !/\.lrv$/i.test(item.name) && !seenIds.has(item.id),
        )
        if (pending.length === 0) return

        const driveRels: string[] = []
        for (const item of pending) {
          const rawRel = (item.relativePath || item.name)
            .replaceAll('\\', '/')
            .replace(/^\/+|\/+$/g, '')
          driveRels.push(
            pathPrefixForScan ? `${pathPrefixForScan}/${rawRel}` : rawRel,
          )
        }
        ensureLiveFolderSources(driveRels)

        const fresh = pending.map((item, index) => {
          seenIds.add(item.id)
          const rawRel = (item.relativePath || item.name)
            .replaceAll('\\', '/')
            .replace(/^\/+|\/+$/g, '')
          const key = normalizeRelPath(rawRel)
          seenPaths.add(key)
          const prev = existingByPath.get(key)
          let merged = mergeScanMedia(
            {
              ...item,
              takenAt: item.takenAt ? new Date(item.takenAt) : undefined,
              url: undefined,
              available: true,
            } as MediaItem,
            prev,
          )
          // Canlı yayında çocuk klasörlere yaz — gizli çapa / offline etiketinde pin kaybolmasın
          if (isDriveLiveScan) {
            const driveRel = driveRels[index]!
            const seeded =
              merged.sourceId === liveDriveId
                ? { ...merged, relativePath: driveRel }
                : rewriteItemSource(merged, liveDriveId, driveRel)
            merged = assignItemToDriveChild(seeded, driveRel, liveChildren)
          }
          // Sonraki birleştirmeler için güncel GPS'i tut
          existingByPath.set(key, merged)
          return merged
        })

        setItems((prev) => {
          const others = prev.filter((item) => !familyIds.has(item.sourceId))
          const family = new Map<string, MediaItem>()
          for (const item of prev) {
            if (!familyIds.has(item.sourceId)) continue
            // pathKeyFor null olsa bile düşürme (yetim / bayat sourceId)
            const key =
              pathKeyFor(item) ??
              (normalizeRelPath(item.relativePath || item.name) || item.id)
            family.set(key, item)
          }
          const staleIds: string[] = []
          for (const item of fresh) {
            const key =
              pathKeyFor(item) ??
              (normalizeRelPath(item.relativePath || item.name) || item.id)
            const old = family.get(key)
            if (old && old.id !== item.id) staleIds.push(old.id)
            family.set(key, item)
          }
          if (staleIds.length > 0) void deleteLibraryItems(staleIds)
          return [...others, ...family.values()]
        })
        void putLibraryItems(fresh.map(toLibraryItem))
      }

      if (data.jobId) {
        let after = 0
        for (;;) {
          if (signal.aborted) break
          await new Promise<void>((resolve) => window.setTimeout(resolve, 120))
          if (signal.aborted) break
          const statusResponse = await fetch(
            `/api/scan/${encodeURIComponent(data.jobId)}?after=${after}`,
            { signal },
          )
          const status = await readJsonResponse<{
            error?: string
            total?: number
            processed?: number
            itemCount?: number
            done?: boolean
            located?: number
            missing?: number
            cancelled?: boolean
            phase?: string
            items?: Array<Omit<MediaItem, 'takenAt'> & { takenAt?: string }>
          }>(statusResponse)
          if (!statusResponse.ok) {
            throw new Error(status.error || 'Tarama durumu okunamadı.')
          }
          setLocalApiAvailable(true)
          if (status.items?.length) {
            received.push(...status.items)
            publishLive(status.items)
          }
          after = status.itemCount ?? after
          setScans((prev) => new Map(prev).set(sourceId, {
          done: status.processed ?? 0,
          total: status.total ?? 0,
          located: status.located ?? 0,
          missing: status.missing ?? 0,
          }))
          if (status.done || status.cancelled) {
            if (status.error && !status.cancelled) throw new Error(status.error)
            break
          }
        }
      } else if (data.items) {
        // Eski hizmet açıksa yine de taramayı tamamla; yalnızca canlı sayaç yoktur.
        received.push(...data.items)
        publishLive(data.items)
      } else {
        throw new Error(data.error || 'Yerel tarama başlatılamadı.')
      }
      if (signal.aborted) {
        // Aynı kaynakta yeni tarama başladıysa bu iptal değil — sessiz çık
        if (scanControllersRef.current.get(sourceId) === controller) {
          setError('Tarama iptal edildi. Bulunanlar haritada kaldı.', 'info')
        }
        return
      }
      const next = received
        .filter((item) => !/\.lrv$/i.test(item.name))
        .map((item) => ({
          ...item,
          takenAt: item.takenAt ? new Date(item.takenAt) : undefined,
          url: undefined,
        }))
      const mergedNext = next.map((item) => {
        const key = normalizeRelPath(item.relativePath || item.name)
        return mergeScanMedia(item as MediaItem, existingByPath.get(key))
      })
      // Canlı yayında zaten eklendi; finalde bu taranın sonuçlarını netleştir
      let finalItems: MediaItem[] = mergedNext as MediaItem[]
      let childSources: SourceUi[] = []
      const absorbedOrphanIds = new Set<string>()
      let remappedUnderDriveId: string | null = null
      let subtreePrefixForRemap = ''

      if (isDriveRootPath(path) || isDriveChildScan) {
        const driveId = isDriveRootPath(path) ? sourceId : driveIdForScan!
        remappedUnderDriveId = driveId
        subtreePrefixForRemap = isDriveRootPath(path) ? '' : pathPrefixForScan

        const driveRootPath = isDriveRootPath(path)
          ? path
          : localPathForSource(
              sourcesRef.current.find((s) => s.id === driveId)!,
              sourcesRef.current,
            ) ??
            sourcesRef.current.find((s) => s.id === driveId)?.localPath ??
            path

        const driveRelativeItems: MediaItem[] = isDriveRootPath(path)
          ? (mergedNext as MediaItem[])
          : (mergedNext as MediaItem[]).map((item) => {
              const rel = (item.relativePath || item.name)
                .replaceAll('\\', '/')
                .replace(/^\/+/, '')
              const fullRel = pathPrefixForScan
                ? `${pathPrefixForScan}/${rel}`
                : rel
              return rewriteItemSource(item, driveId, fullRel)
            })

        const existingChildren = sourcesRef.current.filter(
          (s) => s.parentId === driveId && s.subPath != null,
        )
        const keptOutside = isDriveRootPath(path)
          ? []
          : existingChildren.filter((s) => {
              const sp = normalizeRelPath(s.subPath ?? '')
              const prefix = normalizeRelPath(pathPrefixForScan)
              return !(
                sp === prefix ||
                (prefix && sp.startsWith(`${prefix}/`))
              )
            })
        const previousSubtree = isDriveRootPath(path)
          ? existingChildren
          : existingChildren.filter((s) => {
              const sp = normalizeRelPath(s.subPath ?? '')
              const prefix = normalizeRelPath(pathPrefixForScan)
              return (
                sp === prefix ||
                (prefix && sp.startsWith(`${prefix}/`))
              )
            })
        const bySubNorm = new Map<string, SourceUi>()
        for (const s of previousSubtree) {
          bySubNorm.set(normalizeRelPath(s.subPath as string), s)
        }

        const folderPaths = mediaFolderSubPaths(driveRelativeItems)
        const folderPathNorm = new Set(folderPaths.map((p) => normalizeRelPath(p)))
        const newSubtree: SourceUi[] = []
        for (const subPath of folderPaths) {
          const childPath =
            subPath === ''
              ? `${driveRootPath.replace(/[\\/]+$/, '')}\\`
              : `${driveRootPath.replace(/[\\/]+$/, '')}\\${subPath.replaceAll('/', '\\')}`
          const prev = bySubNorm.get(normalizeRelPath(subPath))
          if (prev) {
            newSubtree.push({ ...prev, localPath: childPath, subPath })
            continue
          }
          const childId = `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${newSubtree.length}`
          const childLabel =
            subPath === ''
              ? '(kök)'
              : subPath.split('/').filter(Boolean).pop() || subPath
          newSubtree.push({
            id: childId,
            label: childLabel,
            addedAt: Date.now(),
            localPath: childPath,
            parentId: driveId,
            subPath,
            directOnly: true,
          })
        }

        childSources = [...keptOutside, ...newSubtree]

        const sourcesForRemap = [
          ...sourcesRef.current.filter(
            (s) => s.id === driveId || !childSources.some((c) => c.id === s.id),
          ),
          ...childSources,
        ]
        finalItems = remapAllItemsUnderDrive(
          driveRelativeItems,
          driveId,
          childSources.map((c) => ({ id: c.id, subPath: c.subPath ?? '' })),
          sourcesForRemap,
        )

        // Boş kalan çocuk klasör kaynaklarını kaldır (yalnızca bu alt ağaç)
        for (const child of previousSubtree) {
          if (!folderPathNorm.has(normalizeRelPath(child.subPath ?? ''))) {
            await deleteSource(child.id)
            await deleteLibraryItemsBySource(child.id)
          }
        }

        for (const child of newSubtree) {
          await putSource({
            id: child.id,
            label: child.label,
            addedAt: child.addedAt,
            localPath: child.localPath,
            parentId: driveId,
            subPath: child.subPath,
            directOnly: true,
          })
        }

        setExpandedTree((prev) => {
          const nextExpand = new Set(prev)
          for (const key of expandKeysForDriveChildren(driveId, childSources)) {
            nextExpand.add(key)
          }
          return nextExpand
        })
        setGrantedIds((prev) => {
          const nextGranted = new Set(prev)
          nextGranted.add(driveId)
          for (const child of childSources) nextGranted.add(child.id)
          return nextGranted
        })
        setLocalOnlineIds((prev) => {
          const nextOnline = new Set(prev)
          nextOnline.add(driveId)
          for (const child of childSources) nextOnline.add(child.id)
          return nextOnline
        })

        // Aynı isimli veya sürücü yolu altındaki üst seviye “Klasör ekle” kaynaklarını birleştir
        if (isDriveRootPath(path)) {
          const childLabels = new Set(
            childSources.map((c) => c.label.toLowerCase()),
          )
          const driveRootNorm = normalizeWinPath(driveRootPath)
          for (const s of sourcesRef.current) {
            if (s.isAnchor || s.parentId || s.id === sourceId) continue
            if (childSources.some((c) => c.id === s.id)) continue
            const orphanPath = (
              localPathForSource(s, sourcesRef.current) ??
              s.localPath ??
              ''
            )
            const underDrive =
              orphanPath &&
              (normalizeWinPath(orphanPath) === driveRootNorm ||
                normalizeWinPath(orphanPath).startsWith(`${driveRootNorm}\\`))
            if (!underDrive && !childLabels.has(s.label.toLowerCase())) continue
            absorbedOrphanIds.add(s.id)
          }
          if (absorbedOrphanIds.size > 0) {
            absorbedCount += absorbedOrphanIds.size
            for (const rid of absorbedOrphanIds) {
              void deleteSource(rid)
              void deleteLibraryItemsBySource(rid)
              handlesRef.current.delete(rid)
            }
            setHiddenSourceIds((current) => {
              let changed = false
              const next = new Set(current)
              for (const rid of absorbedOrphanIds) {
                if (next.delete(rid)) changed = true
              }
              if (changed) {
                localStorage.setItem(HIDDEN_SOURCES_KEY, JSON.stringify([...next]))
              }
              return changed ? next : current
            })
          }
        }
      }

      // Fark: diskte olmayanları sil, id değişen eskileri temizle, yenileri yaz
      const finalByPath = new Map<string, MediaItem>()
      for (const item of finalItems) {
        const rawKey =
          remappedUnderDriveId
            ? itemPathUnderRoot(
                item,
                [...sourcesRef.current, ...childSources],
                remappedUnderDriveId,
              ) ?? (item.relativePath || item.name)
            : item.relativePath || item.name
        finalByPath.set(normalizeRelPath(rawKey), item)
      }
      // existingByPath anahtarları alt klasör taramasında göreli; sürücü göreliyle eşle
      const existingByDrivePath = new Map<string, MediaItem>()
      if (remappedUnderDriveId && subtreePrefixForRemap) {
        const prefixKey = normalizeRelPath(subtreePrefixForRemap)
        for (const [key, item] of existingByPath) {
          const driveKey = key ? `${prefixKey}/${key}` : prefixKey
          existingByDrivePath.set(normalizeRelPath(driveKey), item)
        }
      } else {
        for (const [key, item] of existingByPath) {
          existingByDrivePath.set(normalizeRelPath(key), item)
        }
      }
      const removedIds: string[] = []
      let addedCount = 0
      let removedCount = 0
      let updatedCount = 0
      for (const [key, old] of existingByDrivePath) {
        const neu = finalByPath.get(key)
        if (!neu) {
          removedIds.push(old.id)
          removedCount += 1
          continue
        }
        if (neu.id !== old.id) {
          removedIds.push(old.id)
          updatedCount += 1
        } else if (
          old.locationMissing !== neu.locationMissing ||
          old.latitude !== neu.latitude ||
          old.longitude !== neu.longitude
        ) {
          updatedCount += 1
        }
      }
      for (const [key] of finalByPath) {
        if (!existingByDrivePath.has(key)) addedCount += 1
      }
      if (removedIds.length > 0) await deleteLibraryItems(removedIds)
      await putLibraryItems(finalItems.map(toLibraryItem))

      setItems((prev) => {
        const childIdSet = new Set(childSources.map((c) => c.id))
        const subtreeIds =
          remappedUnderDriveId && subtreePrefixForRemap
            ? driveSubtreeSourceIds(
                remappedUnderDriveId,
                subtreePrefixForRemap,
                sourcesRef.current,
              )
            : null
        const keptOther = prev.filter((item) => {
          if (absorbedOrphanIds.has(item.sourceId)) return false
          if (subtreeIds) {
            if (subtreeIds.has(item.sourceId)) return false
            if (item.sourceId === sourceId) return false
            if (childIdSet.has(item.sourceId)) return false
            return true
          }
          if (item.sourceId === sourceId) return false
          if (childIdSet.has(item.sourceId)) return false
          const parent = sourcesRef.current.find((s) => s.id === item.sourceId)
          if (parent?.parentId === sourceId) return false
          return true
        })
        const byId = new Map(keptOther.map((item) => [item.id, item]))
        for (const item of finalItems) byId.set(item.id, item)
        return [...byId.values()]
      })
      setSources((prev) => {
        if (remappedUnderDriveId && !isDriveRootPath(path)) {
          // Alt ağaç yeniden tarandı: çapa + dış çocuklar + yeni alt ağaç
          const next = prev.filter((source) => {
            if (absorbedOrphanIds.has(source.id)) return false
            if (source.id === sourceId) {
              // Tarama kaynağı yeni alt ağaçta yeniden kullanıldıysa kalsın
              return childSources.some((c) => c.id === sourceId)
            }
            if (source.parentId === remappedUnderDriveId) {
              const sp = normalizeRelPath(source.subPath ?? '')
              const prefix = normalizeRelPath(subtreePrefixForRemap)
              if (
                sp === prefix ||
                (prefix && sp.startsWith(`${prefix}/`))
              ) {
                return childSources.some((c) => c.id === source.id)
              }
            }
            return true
          })
          const have = new Set(next.map((s) => s.id))
          for (const child of childSources) {
            if (!have.has(child.id)) {
              next.push(child)
              have.add(child.id)
            } else {
              const idx = next.findIndex((s) => s.id === child.id)
              if (idx >= 0) next[idx] = { ...next[idx], ...child }
            }
          }
          return next
        }
        const withoutStaleChildren = prev.filter(
          (source) =>
            !absorbedOrphanIds.has(source.id) &&
            source.id !== sourceId &&
            !(source.parentId === sourceId && !childSources.some((c) => c.id === source.id)),
        )
        const anchor: SourceUi = {
          ...(sourcesRef.current.find((source) => source.id === sourceId) ?? {
            id: sourceId,
            label,
            addedAt: startedAt,
          }),
          id: sourceId,
          label,
          localPath: path,
          addedAt:
            sourcesRef.current.find((source) => source.id === sourceId)?.addedAt ??
            startedAt,
          isAnchor: isDriveRootPath(path),
          parentId: undefined,
          subPath: undefined,
        }
        if (!isDriveRootPath(path)) {
          const existingSource = sourcesRef.current.find((source) => source.id === sourceId)
          return [
            ...withoutStaleChildren.filter((s) => s.id !== sourceId),
            {
              ...anchor,
              isAnchor: existingSource?.isAnchor ?? false,
              parentId: existingSource?.parentId,
              subPath: existingSource?.subPath,
              directOnly: existingSource?.directOnly,
            },
          ]
        }
        return [...withoutStaleChildren, anchor, ...childSources]
      })
      const existingSource = sourcesRef.current.find((source) => source.id === sourceId)
      const existingHandle = handlesRef.current.get(sourceId)
      // Alt ağaç yeniden dağıtıldıysa çapa yolunu bozma; çocuklar putSource ile yazıldı
      if (!(remappedUnderDriveId && !isDriveRootPath(path))) {
        await putSource({
          id: sourceId,
          label,
          addedAt: existingSource?.addedAt ?? startedAt,
          handle: existingHandle,
          localPath: path,
          parentId: isDriveRootPath(path) ? undefined : existingSource?.parentId,
          subPath: isDriveRootPath(path) ? undefined : existingSource?.subPath,
          isAnchor: isDriveRootPath(path) || (existingSource?.isAnchor ?? false),
          directOnly: isDriveRootPath(path) ? undefined : existingSource?.directOnly,
        })
      }
      setGrantedIds((prev) => new Set(prev).add(sourceId))
      const missingGps = finalItems.filter((item) => item.locationMissing).length
      setSkipped(missingGps)
      setViewer(null)
      const locatedCount = finalItems.length - missingGps
      const sourceName = label || path
      const branchNote =
        remappedUnderDriveId && childSources.length > 0
          ? ` · ${childSources.filter((c) => {
              if (isDriveRootPath(path)) return true
              const sp = (c.subPath ?? '')
                .replaceAll('\\', '/')
                .replace(/^\/+|\/+$/g, '')
              return (
                sp === subtreePrefixForRemap ||
                (subtreePrefixForRemap &&
                  sp.startsWith(`${subtreePrefixForRemap}/`))
              )
            }).length} klasör`
          : ''
      const absorbNote =
        absorbedCount > 0 ? ` · ${absorbedCount} alt kaynak birleştirildi` : ''
      const diffNote = isRescan
        ? ` · +${addedCount} / −${removedCount}` +
          (updatedCount > 0 ? ` / ~${updatedCount}` : '')
        : ''
      const pct =
        finalItems.length > 0
          ? Math.round((locatedCount / finalItems.length) * 100)
          : 0
      setNotice({
        title: isRescan || existingId ? 'Tarama güncellendi' : 'Tarama tamamlandı',
        message: `“${sourceName}”${branchNote}${absorbNote}${diffNote}`,
        stats: [
          { label: 'Medya', value: String(finalItems.length) },
          { label: 'GPS bulundu', value: `${locatedCount} (%${pct})` },
          { label: 'GPS yok', value: String(missingGps) },
          ...(isRescan
            ? [
                {
                  label: 'Değişim',
                  value: `+${addedCount} / −${removedCount}${
                    updatedCount > 0 ? ` / ~${updatedCount}` : ''
                  }`,
                },
              ]
            : []),
        ],
      })
      setError(
        isRescan || existingId
          ? `“${sourceName}” güncellendi · ${finalItems.length} medya (${locatedCount} GPS)`
          : `“${sourceName}” eklendi · ${finalItems.length} medya (${locatedCount} GPS)`,
        'info',
      )
    } catch (e) {
      if (signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
        if (scanControllersRef.current.get(sourceId) === controller) {
          setError('Tarama iptal edildi. Bulunanlar haritada kaldı.', 'info')
        }
        return
      }
      const msg = e instanceof Error ? e.message : ''
      if (
        /failed to fetch|networkerror|load failed|geçersiz|proxy|ulaşılamadı/i.test(
          msg,
        ) ||
        e instanceof TypeError
      ) {
        setLocalApiAvailable(false)
      }
      setError(friendlyError(e, 'Yerel klasör taranamadı.'))
    } finally {
      // Yerine yeni tarama geldiyse onun controller/progress kaydını silme
      if (scanControllersRef.current.get(sourceId) === controller) {
        scanControllersRef.current.delete(sourceId)
        scanJobIdsRef.current.delete(sourceId)
        setScans((prev) => {
          const nextMap = new Map(prev)
          nextMap.delete(sourceId)
          return nextMap
        })
      }
    }
  }, [setError])

  /** Masaüstünde yol seçici; web’de yalnızca tarayıcı klasör/dosya seçici. */
  const addFolderSmart = useCallback(async () => {
    // localApiAvailable false olsa bile dene — probe gecikmesi klasör eklemeyi kilitlemesin
    if (showDriveAdd || showDesktopSources) {
      try {
        const pick = await fetch('/api/pick-folder', { method: 'POST' })
        if (pick.ok) {
          const data = await readJsonResponse<{
            path?: string
            cancelled?: boolean
            error?: string
          }>(pick)
          if (data.cancelled) return
          if (data.path) {
            setLocalApiAvailable(true)
            setSourcesOpen(true)
            await scanLocalPath(data.path)
            return
          }
        } else if (showDesktopSources) {
          const data = await readJsonResponse<{ error?: string }>(pick).catch(() => ({}))
          setError(
            (data as { error?: string }).error ||
              'Klasör seçilemedi. baslat-v2.bat / yerel API çalışıyor mu?',
          )
          return
        }
      } catch (e) {
        if (showDesktopSources) {
          setError(friendlyError(e, 'Klasör seçilemedi. Yerel API kapalı olabilir.'))
          return
        }
        /* FSA’ya düş */
      }
    }
    await addFolder()
  }, [addFolder, scanLocalPath, showDesktopSources, showDriveAdd, setError])

  const loadSourceFiles = useCallback(
    async (id: string) => {
      const handle = handlesRef.current.get(id)
      if (!handle) return []
      const source = sourcesRef.current.find((s) => s.id === id)
      const accept = (name: string) =>
        acceptsFileName(name, enabledKindsRef.current)
      if (source?.directOnly) {
        return readDirectFilesFromHandle(handle, accept)
      }
      return readFilesFromHandle(handle, accept)
    },
    [],
  )

  /**
   * Tek parça eklenmiş klasörü (ör. 2.7GB) medyalı alt klasör dallarına böler.
   * Ağaçta alt klasörler görünür; her dal kendi dosyalarını tarar.
   */
  const expandSourceBranches = useCallback(
    async (id: string) => {
      const source = sourcesRef.current.find((s) => s.id === id)
      const handle = handlesRef.current.get(id)
      if (!source || !handle) return
      if (source.isAnchor) {
        setError('Bu zaten bir sürücü kökü; alt dallar ▸ ile açılır.')
        return
      }

      try {
        const ok = await ensureReadPermission(handle, true)
        if (!ok) {
          setError('Klasör izni verilmedi.')
          return
        }

        setError(`"${source.label}" altında medyalı klasörler aranıyor…`, 'info')
        const discovered = await discoverMediaFolders(handle, isSupportedMediaFileName)
        const nested = discovered.filter((d) => d.subPath !== '')
        if (nested.length === 0) {
          setError(
            `"${source.label}" altında ayrı medya klasörü yok. ` +
              'Dosyalar doğrudan bu klasörde veya alt klasörlerde medya bulunamadı.',
          )
          return
        }

        const driveParentId = source.parentId
        const baseSubPath = source.subPath?.replace(/\/$/, '') ?? ''
        const anchorId = driveParentId ?? id

        // Eski tek parça kütüphaneyi temizle (dallar yeniden tarayacak)
        await deleteLibraryItemsBySource(id)
        for (const [key, url] of urlCacheRef.current) {
          if (key.startsWith(`${id}|`)) {
            URL.revokeObjectURL(url)
            urlCacheRef.current.delete(key)
          }
        }
        for (const key of [...fileMapRef.current.keys()]) {
          if (key.startsWith(`${id}|`)) fileMapRef.current.delete(key)
        }
        setItems((prev) => prev.filter((i) => i.sourceId !== id))

        if (!driveParentId) {
          // Tepe klasör → çapa (ağaç kökü)
          await putSource({
            id,
            label: source.label,
            addedAt: source.addedAt,
            handle,
            isAnchor: true,
          })
          setSources((prev) =>
            prev.map((s) =>
              s.id === id
                ? {
                    ...s,
                    isAnchor: true,
                    directOnly: undefined,
                    parentId: undefined,
                    subPath: undefined,
                  }
                : s,
            ),
          )
        } else {
          // Sürücü altındaki şişkin klasörü kaldır; dallar sürücüye bağlanır
          await deleteSource(id)
          handlesRef.current.delete(id)
          setSources((prev) => prev.filter((s) => s.id !== id))
          setGrantedIds((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        }

        const existingPaths = new Set(
          sourcesRef.current
            .filter((s) => s.parentId === anchorId && s.subPath != null)
            .map((s) => s.subPath as string),
        )

        const newChildren: SourceUi[] = []
        for (const folder of discovered) {
          const fullSub = driveParentId
            ? folder.subPath
              ? `${baseSubPath}/${folder.subPath}`
              : baseSubPath
            : folder.subPath
          if (existingPaths.has(fullSub)) continue

          const childId = `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          const label =
            fullSub.split('/').filter(Boolean).pop() || source.label
          handlesRef.current.set(childId, folder.handle)
          const record = {
            id: childId,
            label,
            addedAt: Date.now(),
            handle: folder.handle,
            parentId: anchorId,
            subPath: fullSub,
            directOnly: true as const,
          }
          await putSource(record)
          newChildren.push({
            id: childId,
            label,
            addedAt: record.addedAt,
            parentId: anchorId,
            subPath: fullSub,
            directOnly: true,
          })
          existingPaths.add(fullSub)
        }

        setGrantedIds((prev) => {
          const next = new Set(prev).add(anchorId)
          for (const c of newChildren) next.add(c.id)
          return next
        })
        setSources((prev) => [...prev, ...newChildren])
        setExpandedTree((prev) => {
          const next = new Set(prev)
          // Kullanıcının tıkladığı kaynak yolunu açık bırak; onun altını
          // otomatik açma.
          if (baseSubPath) next.add(`${anchorId}::${baseSubPath}`)
          return next
        })

        setError(
          `"${source.label}": ${newChildren.length} alt dal eklendi. GPS okunuyor…`,
        )
        await forEachWithConcurrency(newChildren, 2, async (child) => {
          const h = handlesRef.current.get(child.id)
          if (!h) return
          const files = await readDirectFilesFromHandle(h, (name) =>
            acceptsFileName(name, enabledKindsRef.current),
          )
          if (files.length > 0) await ingest(files, child.id, true)
        })
      } catch (e) {
        setError(friendlyError(e, 'Alt klasörler keşfedilemedi.'))
      }
    },
    [ingest],
  )

  /** Sürücü kökünü ekler, medyalı klasörleri alt dal olarak keşfeder ve tarar. */
  const registerDrive = useCallback(async () => {
    if (!canPickFolder()) return
    try {
      const handle = await pickFolderHandle()
      if (handle === null || handle === 'cancelled') return
      // Sürücü yeniden eklendiğinde otomatik keşif/tarama ilerlemesini göster.
      setSourcesOpen(true)

      for (const [, h] of handlesRef.current) {
        if (await isSameFolder(h, handle)) {
          setError('Bu sürücü/klasör zaten kayıtlı.')
          return
        }
      }

      const typed = window.prompt(
        'Sürücü/disk adı (ör. "4TB Seyahat", "1TB Yedek"):',
        handle.name,
      )
      if (typed === null) return
      const driveLabel = typed.trim() || handle.name

      const anchorId = `src-anchor-${Date.now()}`
      const addedAt = Date.now()
      handlesRef.current.set(anchorId, handle)
      await putSource({
        id: anchorId,
        label: driveLabel,
        addedAt,
        handle,
        isAnchor: true,
      })

      setError(`"${driveLabel}" taranıyor: medyalı klasörler aranıyor…`, 'info')
      const discovered = await discoverMediaFolders(handle, isSupportedMediaFileName)

      // Mevcut kaynakları bu kökün altına bağla
      const relinked = new Map<string, { parentId: string; subPath: string }>()
      for (const source of sourcesRef.current) {
        if (source.isAnchor || source.parentId) continue
        const h = handlesRef.current.get(source.id)
        if (!h) continue
        const rel = await relativePathIfDescendant(handle, h)
        if (rel) {
          const link = { parentId: anchorId, subPath: rel.join('/') }
          relinked.set(source.id, link)
          await putSource({
            id: source.id,
            label: source.label,
            addedAt: source.addedAt,
            handle: h,
            directOnly: source.directOnly,
            ...link,
          })
        }
      }

      const existingPaths = new Set(
        [...relinked.values()].map((l) => l.subPath),
      )
      for (const source of sourcesRef.current) {
        if (source.parentId === anchorId && source.subPath != null) {
          existingPaths.add(source.subPath)
        }
      }

      const newChildren: SourceUi[] = []
      for (const folder of discovered) {
        if (existingPaths.has(folder.subPath)) continue
        const childId = `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const label =
          folder.subPath.split('/').filter(Boolean).pop() || driveLabel
        handlesRef.current.set(childId, folder.handle)
        const record = {
          id: childId,
          label,
          addedAt: Date.now(),
          handle: folder.handle,
          parentId: anchorId,
          subPath: folder.subPath,
          directOnly: true,
        }
        await putSource(record)
        newChildren.push({
          id: childId,
          label,
          addedAt: record.addedAt,
          parentId: anchorId,
          subPath: folder.subPath,
          directOnly: true,
        })
        existingPaths.add(folder.subPath)
      }

      setGrantedIds((prev) => {
        const next = new Set(prev).add(anchorId)
        for (const c of newChildren) next.add(c.id)
        return next
      })
      setSources((prev) => [
        ...prev.map((s) => {
          const link = relinked.get(s.id)
          return link ? { ...s, ...link } : s
        }),
        { id: anchorId, label: driveLabel, addedAt, isAnchor: true },
        ...newChildren,
      ])

      const totalDirect = discovered.reduce((sum, f) => sum + f.directCount, 0)
      setError(
        `"${driveLabel}": ${newChildren.length} medyalı klasör bulundu` +
          (totalDirect ? ` (~${totalDirect} dosya). GPS okunuyor…` : '.'),
      )

      // Her dalı kendi klasöründe tara (yalnızca doğrudan dosyalar)
      await forEachWithConcurrency(newChildren, 2, async (child) => {
        const childHandle = handlesRef.current.get(child.id)
        if (!childHandle) return
        const files = await readDirectFilesFromHandle(childHandle, (name) =>
          acceptsFileName(name, enabledKindsRef.current),
        )
        if (files.length > 0) await ingest(files, child.id, true)
      })
    } catch (e) {
      setError(friendlyError(e, 'Sürücü eklenemedi.'))
    }
  }, [ingest])

  const reconnectSource = useCallback(
    async (id: string) => {
      const source = sourcesRef.current.find((item) => item.id === id)
      if (source) {
        let path = localPathForSource(source, sourcesRef.current)
        if (!path) {
          const handle = handlesRef.current.get(id)
          if (handle) {
            try {
              const ok = await ensureReadPermission(handle, true)
              if (ok && (await isSourceAvailable(handle))) {
                setGrantedIds((prev) => new Set(prev).add(id))
                setError(null)
                return
              }
            } catch { /* alttaki yol isteği */ }
          }
          const typed = window.prompt(
            `"${source.label}" klasörünün tam yolunu yaz (ör. E:\\DCIM\\100GOPRO):`,
            '',
          )
          path = typed?.trim() || undefined
          if (!path) {
            setError(
              'Bu kaynak için klasör yolu yok. Yolu yaz veya kaynağı kaldırıp “+ Sürücü ekle” ile yeniden ekle.',
            )
            return
          }
        }
        await scanLocalPath(path, id, source.label)
        return
      }
      const handle = handlesRef.current.get(id)
      if (!handle) return
      try {
        const ok = await ensureReadPermission(handle, true)
        if (ok && (await isSourceAvailable(handle))) {
          setGrantedIds((prev) => new Set(prev).add(id))
          setError(null)
          // Kütüphanede bu kaynağa ait kayıt yoksa (ör. eski sürümden
          // aktarılan klasör) otomatik tara; önbellek sayesinde hızlıdır.
          // Taramalar eşzamanlı çalışır, diğerlerini etkilemez.
          const hasItems = itemsRef.current.some((i) => i.sourceId === id)
          if (!hasItems && !scanControllersRef.current.has(id)) {
            const files = await loadSourceFiles(id)
            if (files.length > 0) await ingest(files, id, true)
          }
        } else {
          setError('Disk bağlı değil ya da izin verilmedi.')
        }
      } catch (e) {
        setError(friendlyError(e, 'Kaynağa bağlanılamadı.'))
      }
    },
    [ingest, loadSourceFiles, scanLocalPath],
  )

  const rescanSource = useCallback(
    async (id: string) => {
      const source = sourcesRef.current.find((item) => item.id === id)
      const path = source
        ? localPathForSource(source, sourcesRef.current)
        : undefined
      if (path?.trim()) {
        await scanLocalPath(path, id, source?.label)
        return
      }
      const handle = handlesRef.current.get(id)
      if (handle) {
        try {
          const ok = await ensureReadPermission(handle, true)
          if (!ok) {
            setError('Klasör izni verilmedi.')
            return
          }
          setGrantedIds((prev) => new Set(prev).add(id))
          const files = await loadSourceFiles(id)
          await ingest(files, id, true)
        } catch (e) {
          setError(friendlyError(e, 'Klasör taranamadı.'))
        }
        return
      }
      if (source) {
        const typed = window.prompt(
          `"${source.label}" için klasör/sürücü yolu:`,
          source.isAnchor ? '' : '',
        )
        const typedPath = typed?.trim()
        if (!typedPath) {
          setError(
            'Bu kaynak için yol veya klasör izni yok. “Diski bağla” ile izin ver veya yolu yaz.',
          )
          return
        }
        await scanLocalPath(typedPath, id, source.label)
      }
    },
    [ingest, loadSourceFiles, scanLocalPath],
  )

  /** Konumu olmayan medyada GPS’i dosya dosya yeniden oku (Konum Bulucu worker; tam klasör taraması yok). */
  const retryMissingGps = useCallback(
    async (opts?: { onlyFailed?: boolean }) => {
      const onlyFailed = Boolean(opts?.onlyFailed)
      if (!(await probeLocalApi(2500, 2))) {
        setLocalApiAvailable(false)
        setError(localApiMissingHint(editionV2 ? 'v2' : 'v1'))
        return
      }
      setLocalApiAvailable(true)

      if (
        scanControllersRef.current.size > 0 ||
        scanJobIdsRef.current.size > 0
      ) {
        setError(
          'Şu an tarama var — bitince “Konum yokları yeniden dene”ye bas.',
          'info',
        )
        return
      }

      const targets: Array<{ id: string; path: string }> = []
      const seenPath = new Set<string>()
      for (const item of itemsRef.current) {
        if (!item.locationMissing) continue
        if (onlyFailed && item.gpsExtractFailed !== true) continue
        const path = windowsPathForItem(item, sourcesRef.current)
        if (!path?.trim()) continue
        const key = path.replace(/\//g, '\\').toLowerCase()
        if (seenPath.has(key)) continue
        seenPath.add(key)
        targets.push({ id: item.id, path: path.trim() })
      }
      if (targets.length === 0) {
        setError(
          onlyFailed
            ? 'Yeniden denenecek GPS okuma hatası yok.'
            : 'Konumu olmayan medya yok (veya dosya yolu yok — sürücüyü ↻ ile tara).',
          'info',
        )
        return
      }

      const progressId = `gps-retry`
      setScans((prev) => new Map(prev).set(progressId, { done: 0, total: targets.length, located: 0, missing: 0 }))
      setError(
        `${targets.length} dosyada GPS yeniden okunuyor (Konum Bulucu)…`,
        'info',
      )

      const byPath = new Map(targets.map((t) => [t.path.replace(/\//g, '\\').toLowerCase(), t.id]))
      const patch = new Map<
        string,
        {
          latitude: number
          longitude: number
          locationMissing: boolean
          gpsExtractFailed: boolean
          takenAt?: Date
        }
      >()

      const applyRow = (row: {
        path: string
        ok: boolean
        latitude?: number
        longitude?: number
        locationMissing?: boolean
        takenAt?: string | null
      }) => {
        const id = byPath.get(row.path.replace(/\//g, '\\').toLowerCase())
        if (!id) return
        if (row.ok && !row.locationMissing && row.latitude != null && row.longitude != null) {
          patch.set(id, {
            latitude: row.latitude,
            longitude: row.longitude,
            locationMissing: false,
            gpsExtractFailed: false,
            takenAt: row.takenAt ? new Date(row.takenAt) : undefined,
          })
        } else if (row.ok) {
          patch.set(id, {
            latitude: 0,
            longitude: 0,
            locationMissing: true,
            gpsExtractFailed: false,
          })
        } else {
          patch.set(id, {
            latitude: 0,
            longitude: 0,
            locationMissing: true,
            gpsExtractFailed: true,
          })
        }
      }

      const flushPatch = async (final: boolean) => {
        if (patch.size === 0) return
        const nextItems = itemsRef.current.map((item) => {
          const hit = patch.get(item.id)
          if (!hit) return item
          return {
            ...item,
            latitude: hit.latitude,
            longitude: hit.longitude,
            locationMissing: hit.locationMissing,
            gpsExtractFailed: hit.gpsExtractFailed,
            takenAt:
              hit.takenAt && !Number.isNaN(hit.takenAt.getTime())
                ? hit.takenAt
                : item.takenAt,
          }
        })
        itemsRef.current = nextItems
        setItems(nextItems)
        if (final) await putLibraryItems(nextItems.map(toLibraryItem))
      }

      try {
        const batchSize = 80
        let globalDone = 0

        const fetchJson = async <T extends Record<string, unknown>>(
          url: string,
          init?: RequestInit,
        ): Promise<{ res: Response; data: T }> => {
          let lastErr: unknown
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              const res = await fetch(url, init)
              const data = await readJsonResponse<T>(res)
              return { res, data }
            } catch (e) {
              lastErr = e
              const msg = e instanceof Error ? e.message : ''
              // Boş/geçici — kısa bekle, tekrar dene
              if (
                /boş yanıt|geçersiz|failed to fetch|networkerror|load failed/i.test(
                  msg,
                ) &&
                attempt < 3
              ) {
                await new Promise<void>((r) =>
                  window.setTimeout(r, 400 * (attempt + 1)),
                )
                continue
              }
              throw e
            }
          }
          throw lastErr instanceof Error
            ? lastErr
            : new Error('GPS API yanıtı alınamadı.')
        }

        for (let offset = 0; offset < targets.length; offset += batchSize) {
          const batch = targets.slice(offset, offset + batchSize)
          const { res: start, data: startData } = await fetchJson<{
            error?: string
            jobId?: string
            results?: Array<{
              path: string
              ok: boolean
              latitude?: number
              longitude?: number
              locationMissing?: boolean
              takenAt?: string | null
            }>
          }>(localApiUrl('/api/gps-retry'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: batch.map((t) => t.path) }),
          })
          if (!start.ok) {
            throw new Error(startData.error || 'GPS yeniden okuma başlatılamadı.')
          }

          if (!startData.jobId && startData.results) {
            for (const row of startData.results) applyRow(row)
            globalDone += batch.length
            setScans((prev) => {
              const next = new Map(prev)
              let located = 0
              let missing = 0
              for (const v of patch.values()) {
                if (v.locationMissing) missing += 1
                else located += 1
              }
              next.set(progressId, {
                done: globalDone,
                total: targets.length,
                located,
                missing,
              })
              return next
            })
            await flushPatch(offset + batchSize >= targets.length)
            continue
          }

          if (!startData.jobId) {
            throw new Error(
              'GPS iş kimliği alınamadı — API’yi baslat-v2.bat ile yeniden başlat.',
            )
          }

          let after = 0
          let lastFlush = patch.size
          for (;;) {
            await new Promise<void>((r) => window.setTimeout(r, 250))
            const { res: statusRes, data: status } = await fetchJson<{
              error?: string
              total?: number
              processed?: number
              located?: number
              missing?: number
              resultCount?: number
              done?: boolean
              cancelled?: boolean
              results?: Array<{
                path: string
                ok: boolean
                latitude?: number
                longitude?: number
                locationMissing?: boolean
                takenAt?: string | null
              }>
            }>(
              localApiUrl(
                `/api/gps-retry/${encodeURIComponent(startData.jobId)}?after=${after}`,
              ),
            )
            if (!statusRes.ok) {
              throw new Error(status.error || 'GPS iş durumu okunamadı.')
            }
            for (const row of status.results ?? []) applyRow(row)
            after = status.resultCount ?? after
            const batchProcessed = status.processed ?? after
            setScans((prev) => {
              const next = new Map(prev)
              let located = 0
              let missing = 0
              for (const v of patch.values()) {
                if (v.locationMissing) missing += 1
                else located += 1
              }
              next.set(progressId, {
                done: offset + batchProcessed,
                total: targets.length,
                located,
                missing,
              })
              return next
            })
            if (patch.size - lastFlush >= 20 || status.done) {
              await flushPatch(false)
              lastFlush = patch.size
            }
            if (status.done || status.cancelled) {
              if (status.error && !status.cancelled) throw new Error(status.error)
              globalDone = offset + (status.total ?? batch.length)
              break
            }
          }
        }

        await flushPatch(true)

        if (patch.size === 0) {
          setError('GPS sonucu alınamadı.', 'info')
          return
        }

        const found = [...patch.values()].filter((v) => !v.locationMissing).length
        const still = [...patch.values()].filter((v) => v.locationMissing).length
        const tried = patch.size
        const pct = tried > 0 ? Math.round((found / tried) * 100) : 0
        setNotice({
          title: 'GPS yeniden okuma tamamlandı',
          message: onlyFailed
            ? 'Okuma hatası olan dosyalar yeniden denendi (Konum Bulucu).'
            : 'Konumu olmayan medyalar yeniden okundu (Konum Bulucu).',
          stats: [
            { label: 'Denenen', value: String(tried) },
            { label: 'Konum bulundu', value: `${found} (%${pct})` },
            { label: 'Hâlâ yok', value: String(still) },
          ],
        })
        setError(
          `GPS yeniden okuma: ${found} konum bulundu` +
            (still > 0 ? ` · ${still} hâlâ yok` : ''),
          'info',
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (
          /failed to fetch|networkerror|load failed|ulaşılamadı/i.test(msg) ||
          e instanceof TypeError
        ) {
          setLocalApiAvailable(false)
        }
        // Kısmi sonuç varsa kaydet
        if (patch.size > 0) {
          try {
            await flushPatch(true)
          } catch {
            /* */
          }
        }
        setError(friendlyError(e, 'GPS yeniden okunamadı.'))
      } finally {
        setScans((prev) => {
          const next = new Map(prev)
          next.delete(progressId)
          return next
        })
      }
    },
    [editionV2, setError],
  )

  const prevLocalApiRef = useRef<boolean | null>(null)
  useEffect(() => {
    const prev = prevLocalApiRef.current
    prevLocalApiRef.current = localApiAvailable
    if (prev === null) return
    if (prev === false && localApiAvailable) {
      // Aktif tarama varken yeniden deneme, çalışan işi kesip “iptal” gibi görünür
      if (
        scanControllersRef.current.size > 0 ||
        scanJobIdsRef.current.size > 0
      ) {
        return
      }
      const needs = itemsRef.current.some(
        (i) => i.locationMissing && i.gpsExtractFailed === true,
      )
      if (needs) void retryMissingGps({ onlyFailed: true })
    }
  }, [localApiAvailable, retryMissingGps])

  /**
   * Sürücü ağacı satırı: gerçek kaynak veya yalnızca yol parçası (DCIM, Users…).
   * Çözülebilir disk yolu varsa alt ağacı yeniden tarar — tüm E: gerekmez.
   */
  const rescanTreeFolder = useCallback(
    async (anchorId: string, node: SourceTreeNode) => {
      if (node.source) {
        await rescanSource(node.source.id)
        return
      }
      const anchor = sourcesRef.current.find((s) => s.id === anchorId)
      if (!anchor) return
      const folderPath = localPathForTreeNode(anchor, node, sourcesRef.current)
      if (!folderPath?.trim()) {
        setError('Bu klasörün disk yolu yok.')
        return
      }
      if (!node.path) {
        const root =
          localPathForSource(anchor, sourcesRef.current) ?? anchor.localPath
        if (root?.trim()) await scanLocalPath(root, anchorId, anchor.label)
        else setError('Sürücü yolu bulunamadı.')
        return
      }
      const prefix = node.path.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
      let target = sourcesRef.current.find(
        (s) => s.parentId === anchorId && (s.subPath ?? '') === prefix,
      )
      if (!target) {
        const childId = `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        target = {
          id: childId,
          label: node.name,
          addedAt: Date.now(),
          localPath: folderPath,
          parentId: anchorId,
          subPath: prefix,
          directOnly: true,
        }
        await putSource({
          id: target.id,
          label: target.label,
          addedAt: target.addedAt,
          localPath: folderPath,
          parentId: anchorId,
          subPath: prefix,
          directOnly: true,
        })
        sourcesRef.current = [...sourcesRef.current, target]
        setSources((prev) =>
          prev.some((s) => s.id === childId) ? prev : [...prev, target!],
        )
        setGrantedIds((prev) => new Set(prev).add(childId))
        setLocalOnlineIds((prev) => new Set(prev).add(childId))
      }
      await scanLocalPath(folderPath, target.id, node.name)
    },
    [rescanSource, scanLocalPath],
  )

  // Eski tarayıcı-tabanlı sürücü ekleme/yığın tarama yolu artık arayüzde
  // gösterilmez; yerel sürücü akışına geçiş tamamlanana kadar saklı tutulur.
  void registerDrive

  // Surucu satiri bir grup basligidir. Buna da bagla/tara eylemi veriyoruz;
  // tarama sonucu basligin altindaki "(kok)" dali olarak gorunur.
  const scanAnchorSource = useCallback(async (anchorId: string) => {
    const anchor = sourcesRef.current.find((source) => source.id === anchorId)
    if (!anchor) return
    const path =
      anchor.localPath ??
      localPathForSource(anchor, sourcesRef.current) ??
      window.prompt(`"${anchor.label}" sürücü yolu (ör. E:\\):`, '') ??
      undefined
    if (!path?.trim()) {
      setError(
        'Sürücü yolu bulunamadı. Kaynağı kaldırıp “+ Sürücü ekle” ile yeniden ekle veya yolu yaz.',
      )
      return
    }

    // Her zaman çapa id ile tara — "(kök)" çocuğuna yazmak çift kayıt üretir
    await putSource({
      id: anchor.id,
      label: anchor.label,
      addedAt: anchor.addedAt,
      localPath: path.trim(),
      isAnchor: true,
    })
    setSources((prev) =>
      prev.map((s) =>
        s.id === anchorId ? { ...s, localPath: path.trim(), isAnchor: true } : s,
      ),
    )
    await scanLocalPath(path.trim(), anchorId, anchor.label)
  }, [scanLocalPath])

  const rescanAll = useCallback(async () => {
    // Sürücü çapaları bir kez; çocuk klasörleri ayrıca tarama (çift kayıt + yavaşlık)
    const targets = sourcesRef.current.filter((s) => {
      if (s.parentId) return false
      const path = localPathForSource(s, sourcesRef.current) ?? s.localPath
      return Boolean(path) || grantedIds.has(s.id)
    })
    if (targets.length === 0) {
      setError(
        'Taranacak bağlı kaynak yok. Önce Kaynaklar’dan “Bağlan” ile diskleri aç.',
      )
      return
    }
    setError(null)
    for (const s of targets) {
      if (s.isAnchor) await scanAnchorSource(s.id)
      else await rescanSource(s.id)
    }
  }, [grantedIds, rescanSource, scanAnchorSource])

  void rescanAll

  const reconnectAllDisconnected = useCallback(async () => {
    const all = sourcesRef.current
    const handleIds = new Set(handlesRef.current.keys())
    const disconnected = all.filter((s) =>
      sourceNeedsReconnect(
        s,
        all,
        grantedIds,
        localOnlineIds,
        localAvailabilityReady,
        handleIds,
      ),
    )
    // Bağlanacak sürücü çapasının alt dallarını atla — çapa taraması yeter
    const reconnectingAnchors = new Set(
      disconnected.filter((s) => s.isAnchor).map((s) => s.id),
    )
    const targets = disconnected.filter(
      (s) => !(s.parentId && reconnectingAnchors.has(s.parentId)),
    )
    if (targets.length === 0) return

    setReconnectingAll(true)
    setError(null)
    try {
      for (const s of targets) {
        if (s.isAnchor) await scanAnchorSource(s.id)
        else await reconnectSource(s.id)
      }
    } finally {
      setReconnectingAll(false)
    }
  }, [
    grantedIds,
    localAvailabilityReady,
    localOnlineIds,
    reconnectSource,
    scanAnchorSource,
  ])

  const removeSource = useCallback(async (id: string) => {
    const target = sourcesRef.current.find((s) => s.id === id)
    const toRemove = target?.isAnchor
      ? [
          id,
          ...sourcesRef.current
            .filter((s) => s.parentId === id)
            .map((s) => s.id),
        ]
      : [id]

    for (const rid of toRemove) {
      await deleteSource(rid)
      await deleteLibraryItemsBySource(rid)
      for (const [key, url] of urlCacheRef.current) {
        if (key.startsWith(`${rid}|`)) {
          URL.revokeObjectURL(url)
          urlCacheRef.current.delete(key)
        }
      }
      for (const key of [...fileMapRef.current.keys()]) {
        if (key.startsWith(`${rid}|`)) fileMapRef.current.delete(key)
      }
      handlesRef.current.delete(rid)
    }

    const removeSet = new Set(toRemove)
    setGrantedIds((prev) => {
      const next = new Set(prev)
      for (const rid of toRemove) next.delete(rid)
      return next
    })
    setSources((prev) => prev.filter((s) => !removeSet.has(s.id)))
    setItems((prev) => prev.filter((i) => !removeSet.has(i.sourceId)))
  }, [])

  const renameSource = useCallback((s: SourceUi) => {
    const typed = window.prompt('Yeni ad:', s.label)
    if (typed === null) return
    const label = typed.trim()
    if (!label || label === s.label) return
    const handle = handlesRef.current.get(s.id)
    if (handle) {
      void putSource({
        id: s.id,
        label,
        addedAt: s.addedAt,
        handle,
        parentId: s.parentId,
        subPath: s.subPath,
        isAnchor: s.isAnchor,
        directOnly: s.directOnly,
      })
    }
    setSources((prev) =>
      prev.map((x) => (x.id === s.id ? { ...x, label } : x)),
    )
  }, [])

  const toggleTreeNode = useCallback((anchorId: string, path: string) => {
    const key = `${anchorId}::${path}`
    setExpandedTree((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleNodeSourcesVisible = useCallback(
    (sourceIds: string[], makeVisible: boolean) => {
      if (sourceIds.length === 0) return
      setHiddenSourceIds((current) => {
        const next = new Set(current)
        for (const id of sourceIds) {
          if (makeVisible) next.delete(id)
          else next.add(id)
        }
        localStorage.setItem(HIDDEN_SOURCES_KEY, JSON.stringify([...next]))
        return next
      })
    },
    [],
  )

  /** Bir sürücü çapası altındaki tüm kaynak id’leri (ağaç + yol yetimleri + medya id’leri). */
  const collectDriveSourceIds = useCallback(
    (anchor: SourceUi): string[] => {
      const root = (
        localPathForSource(anchor, sourcesRef.current) ??
        anchor.localPath ??
        ''
      )
        .replace(/\//g, '\\')
        .replace(/[\\/]+$/, '')
        .toLowerCase()
      const ids: string[] = [anchor.id]
      for (const s of sourcesRef.current) {
        if (s.id === anchor.id) continue
        if (s.isAnchor) continue
        if (s.parentId === anchor.id) {
          ids.push(s.id)
          continue
        }
        const p = (localPathForSource(s, sourcesRef.current) ?? s.localPath ?? '')
          .replace(/\//g, '\\')
          .replace(/[\\/]+$/, '')
          .toLowerCase()
        if (root && p && (p === root || p.startsWith(`${root}\\`))) {
          ids.push(s.id)
        }
      }
      // Medyanın bağlandığı bayat/yetim sourceId’leri de gizle/göster
      for (const item of itemsRef.current) {
        if (itemDriveRelativePath(item, anchor.id, sourcesRef.current) != null) {
          ids.push(item.sourceId)
        }
      }
      return [...new Set(ids)]
    },
    [],
  )

  /** Ağaç satırı: alt kaynaklar + bu yol önekindeki medya sourceId’leri. */
  const collectTreeNodeToggleIds = useCallback(
    (anchorId: string, node: SourceTreeNode): string[] => {
      const ids = new Set(collectDescendantSourceIds(node))
      const prefix = normalizeRelPath(node.path)
      for (const item of itemsRef.current) {
        const rel = itemDriveRelativePath(item, anchorId, sourcesRef.current)
        if (rel == null) continue
        const relKey = normalizeRelPath(rel)
        if (!prefix || relKey === prefix || relKey.startsWith(`${prefix}/`)) {
          ids.add(item.sourceId)
        }
      }
      return [...ids]
    },
    [],
  )

  const renderTreeNode = (
    anchorId: string,
    node: SourceTreeNode,
    depth: number,
  ) => {
    const childSourceIds = collectDescendantSourceIds(node)
    const toggleIds = collectTreeNodeToggleIds(anchorId, node)
    const count = countItemsUnderDrivePrefix(
      items,
      enabledKinds,
      anchorId,
      node.path,
      sources,
      childSourceIds,
    )
    const hasKids = node.children.length > 0
    const expandKey = `${anchorId}::${node.path}`
    const expanded = expandedTree.has(expandKey)
    const source = node.source
    const anchor = sources.find((a) => a.id === anchorId)
    const folderPath = localPathForTreeNode(anchor, node, sources)
    const canRescan = Boolean(folderPath?.trim())
    const allVisible =
      toggleIds.length > 0 &&
      toggleIds.every((id) => !hiddenSourceIds.has(id))
    const someVisible = toggleIds.some((id) => !hiddenSourceIds.has(id))
    const activeScans = childSourceIds
      .map((id) => scans.get(id))
      .filter(
        (progress): progress is { done: number; total: number } =>
          progress !== undefined,
      )
    const scanProgress =
      activeScans.length > 0
        ? {
            done: activeScans.reduce((sum, progress) => sum + progress.done, 0),
            total: activeScans.reduce((sum, progress) => sum + progress.total, 0),
          }
        : undefined
    const isScanning = scanProgress !== undefined
    const handleIds = new Set(handlesRef.current.keys())
    const connected = source
      ? isSourceOnline(
          source,
          sources,
          grantedIds,
          localOnlineIds,
          localAvailabilityReady,
          handleIds,
        )
      : Boolean(
          anchor &&
            isSourceOnline(
              anchor,
              sources,
              grantedIds,
              localOnlineIds,
              localAvailabilityReady,
              handleIds,
            ),
        )

    return (
      <div key={`${anchorId}:${node.path || node.name}`}>
        <div
          className={`source-row source-row--tree ${source ? '' : 'source-row--virtual'}`}
          style={{ ['--tree-depth' as string]: depth }}
        >
          {hasKids ? (
            <button
              type="button"
              className={`source-row__twist ${expanded ? 'is-open' : ''}`}
              onClick={() => toggleTreeNode(anchorId, node.path)}
              aria-expanded={expanded}
              title={expanded ? 'Daralt' : 'Genişlet'}
            />
          ) : (
            <span className="source-row__twist-spacer" aria-hidden />
          )}

          {toggleIds.length > 0 ? (
            <input
              type="checkbox"
              className="source-row__pick"
              checked={allVisible}
              ref={(el) => {
                if (el) el.indeterminate = someVisible && !allVisible
              }}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation()
                toggleNodeSourcesVisible(toggleIds, e.target.checked)
              }}
              title="Haritada göster / gizle"
            />
          ) : (
            <span className="source-row__pick-spacer" aria-hidden />
          )}

          {source && (
            <span
              className={`source-row__dot ${connected ? 'is-on' : 'is-off'}`}
              aria-hidden
            />
          )}

          <button
            type="button"
            className={`source-row__name ${hasKids ? 'is-branch' : ''}`}
            title={node.path || node.name}
            onClick={() => {
              if (hasKids) toggleTreeNode(anchorId, node.path)
            }}
          >
            {node.name}
          </button>

          <span
            className="source-row__count"
            title="Bu klasördeki medya sayısı"
          >
            {count}
          </span>

          {isScanning && (
            <span className="source-row__scanning">
              {scanProgress && scanProgress.total > 0
                ? `${scanProgress.done}/${scanProgress.total}`
                : 'Dosyalar aranıyor…'}
            </span>
          )}

          {canRescan &&
            !isScanning &&
            (
              <button
                type="button"
                className="source-row__btn source-row__btn--icon"
                onClick={(e) => {
                  e.stopPropagation()
                  // Yerel yolu olan dallar API ile taranır — “offline” olsa bile ↻ çalışsın
                  void rescanTreeFolder(anchorId, node)
                }}
                title={connected ? 'Yeniden tara' : 'Sürücüyü bağla ve tara'}
                aria-label={connected ? 'Yeniden tara' : 'Sürücüyü bağla ve tara'}
              >
                {connected ? '↻' : '↪'}
              </button>
            )}
          {!canRescan &&
            !isScanning &&
            source &&
            !connected && (
              <button
                type="button"
                className="source-row__btn source-row__btn--icon"
                onClick={(e) => {
                  e.stopPropagation()
                  void reconnectSource(source.id)
                }}
                title="Diski bağla / izin ver"
                aria-label="Diski bağla / izin ver"
              >
                ↪
              </button>
            )}

          {(source || node.path) && (
            <button
              type="button"
              className="source-row__btn source-row__btn--icon"
              onClick={() => {
                if (!anchor) return
                const root =
                  localPathForSource(anchor, sources) ?? anchor.localPath
                if (!root) {
                  if (source) void openSourceInExplorer(source)
                  else setError('Bu klasörün disk yolu yok.')
                  return
                }
                const folder = node.path
                  ? `${root.replace(/[\\/]+$/, '')}\\${node.path.replaceAll('/', '\\')}`
                  : root
                void openSourceInExplorer(source ?? anchor, folder)
              }}
              title="Explorer’da klasörü aç"
              aria-label="Explorer’da klasörü aç"
            >
              📁
            </button>
          )}

          {source && (
            <button
              type="button"
              className="source-row__btn source-row__btn--icon source-row__btn--x"
              onClick={() => void removeSource(source.id)}
              title="Bu dalı kaldır"
              disabled={isScanning}
            >
              ×
            </button>
          )}
        </div>
        {hasKids &&
          expanded &&
          node.children.map((child) =>
            renderTreeNode(anchorId, child, depth + 1),
          )}
      </div>
    )
  }

  const renderSourceRow = (s: SourceUi, isChild: boolean) => {
    if (s.isAnchor) {
      const kids = sources.filter((c) => c.parentId === s.id)
      const childCount = countItemsUnderDrivePrefix(
        items,
        enabledKinds,
        s.id,
        '',
        sources,
        [s.id, ...kids.map((c) => c.id)],
      )
      const tree = buildSourceTree(kids)
      const rootKey = `${s.id}::`
      const expanded = expandedTree.has(rootKey)
      const hasKids = tree.length > 0
      const rootSource = kids.find((child) => child.subPath === '')
      const rootIsScanning =
        scans.has(s.id) || (rootSource ? scans.has(rootSource.id) : false)
      // Çapa yolu / availability yeterli — yalnızca "(kök)" çocuğuna bakma
      const handleIds = new Set(handlesRef.current.keys())
      const rootIsLocallyLinked =
        rootIsScanning ||
        Boolean(s.localPath) ||
        Boolean(localPathForSource(s, sources)) ||
        Boolean(rootSource?.localPath) ||
        localOnlineIds.has(s.id) ||
        isSourceOnline(
          s,
          sources,
          grantedIds,
          localOnlineIds,
          localAvailabilityReady,
          handleIds,
        )
      const driveToggleIds = collectDriveSourceIds(s)
      const allDriveVisible =
        driveToggleIds.length > 0 &&
        driveToggleIds.every((id) => !hiddenSourceIds.has(id))
      const someDriveVisible = driveToggleIds.some(
        (id) => !hiddenSourceIds.has(id),
      )

      return (
        <div key={s.id} className="source-tree">
          <div className="source-row source-row--anchor">
            {hasKids ? (
              <button
                type="button"
                className={`source-row__twist ${expanded ? 'is-open' : ''}`}
                onClick={() => toggleTreeNode(s.id, '')}
                aria-expanded={expanded}
                title={expanded ? 'Daralt' : 'Genişlet'}
              />
            ) : (
              <span className="source-row__twist-spacer" aria-hidden />
            )}
            {driveToggleIds.length > 0 ? (
              <input
                type="checkbox"
                className="source-row__pick"
                checked={allDriveVisible}
                ref={(el) => {
                  if (el) el.indeterminate = someDriveVisible && !allDriveVisible
                }}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation()
                  // Yalnızca görünürlük — asla tarama tetikleme
                  toggleNodeSourcesVisible(driveToggleIds, e.target.checked)
                }}
                title="Tüm alt klasörleri haritada göster / gizle"
                aria-label="Tüm alt klasörleri seç veya kaldır"
              />
            ) : (
              <span className="source-row__pick-spacer" aria-hidden />
            )}
            <span className="source-row__drive" aria-hidden>
              💾
            </span>
            <button
              type="button"
              className={`source-row__name source-row__name--anchor ${hasKids ? 'is-branch' : ''}`}
              title={s.label}
              onClick={() => {
                if (hasKids) toggleTreeNode(s.id, '')
              }}
            >
              {s.label}
            </button>
            <span
              className="source-row__count"
              title="Bu sürücüdeki medya sayısı"
            >
              {childCount}
            </span>
            <button
              type="button"
              className="source-row__btn source-row__btn--icon"
              onClick={(e) => {
                e.stopPropagation()
                void scanAnchorSource(s.id)
              }}
              title={rootIsLocallyLinked ? 'Yeniden tara' : 'Sürücüyü bağla ve tara'}
              aria-label={rootIsLocallyLinked ? 'Yeniden tara' : 'Sürücüyü bağla ve tara'}
              disabled={rootIsScanning}
            >
              {rootIsLocallyLinked ? '↻' : '↪'}
            </button>
            <button
              type="button"
              className="source-row__btn source-row__btn--icon"
              onClick={() => void openSourceInExplorer(s)}
              title="Explorer’da sürücüyü aç"
              aria-label="Explorer’da sürücüyü aç"
            >
              📁
            </button>
            <button
              type="button"
              className="source-row__btn source-row__btn--icon"
              onClick={() => renameSource(s)}
              title="Adı değiştir"
              aria-label="Adı değiştir"
            >
              ✎
            </button>
            <button
              type="button"
              className="source-row__btn source-row__btn--icon source-row__btn--x"
              onClick={() => void removeSource(s.id)}
              title="Sürücüyü ve alt dallarını kaldır"
            >
              ×
            </button>
          </div>
          {expanded &&
            tree.map((node) => renderTreeNode(s.id, node, 1))}
        </div>
      )
    }

    const connected = isSourceOnline(
      s,
      sources,
      grantedIds,
      localOnlineIds,
      localAvailabilityReady,
      new Set(handlesRef.current.keys()),
    )
    const visible = !hiddenSourceIds.has(s.id)
    const count = sourceCounts.get(s.id) ?? 0
    const label = isChild && s.subPath ? s.subPath : s.label
    const scanProgress = scans.get(s.id)
    const isScanning = scanProgress !== undefined
    const canExpandBranches =
      !s.directOnly && handlesRef.current.has(s.id)

    return (
      <div
        key={s.id}
        className={`source-row ${isChild ? 'source-row--child' : ''}`}
      >
        <span className="source-row__twist-spacer" aria-hidden />
        <input
          type="checkbox"
          className="source-row__pick"
          checked={visible}
          onChange={() => toggleSourceVisible(s.id)}
          title="Haritada göster / gizle"
        />
        <span
          className={`source-row__dot ${connected ? 'is-on' : 'is-off'}`}
          aria-hidden
        />
        <span className="source-row__name" title={label}>
          {label}
        </span>
        <span className="source-row__count" title="Bu kaynaktaki medya sayısı">
          {count}
        </span>
        {isScanning ? (
          <span className="source-row__scanning">
            {scanProgress && scanProgress.total > 0
              ? `${scanProgress.done}/${scanProgress.total}`
              : 'Dosyalar aranıyor…'}
          </span>
        ) : connected ? (
          <>
            {canExpandBranches && (
              <button
                type="button"
                className="source-row__btn source-row__btn--icon"
                onClick={() => void expandSourceBranches(s.id)}
                title="Alt klasörleri ağaç dalları olarak keşfet"
                aria-label="Alt klasörleri ağaç dalları olarak keşfet"
              >
                ⑂
              </button>
            )}
            <button
              type="button"
              className="source-row__btn source-row__btn--icon"
              onClick={() => void rescanSource(s.id)}
              title="Yeniden tara"
              aria-label="Yeniden tara"
            >
              ↻
            </button>
          </>
        ) : (
          <button
            type="button"
            className="source-row__btn source-row__btn--icon"
            onClick={() => void reconnectSource(s.id)}
            title="Diski bağla / izin ver"
            aria-label="Diski bağla / izin ver"
          >
            ↪
          </button>
        )}
        <button
          type="button"
          className="source-row__btn source-row__btn--icon"
          onClick={() => void openSourceInExplorer(s)}
          title="Explorer’da klasörü aç"
          aria-label="Explorer’da klasörü aç"
        >
          📁
        </button>
        <button
          type="button"
          className="source-row__btn source-row__btn--icon"
          onClick={() => renameSource(s)}
          title="Adı değiştir"
          aria-label="Adı değiştir"
        >
          ✎
        </button>
        <button
          type="button"
          className="source-row__btn source-row__btn--icon source-row__btn--x"
          onClick={() => void removeSource(s.id)}
          title="Kaynağı kaldır"
          disabled={isScanning}
        >
          ×
        </button>
      </div>
    )
  }

  const resetAll = useCallback(async () => {
    await clearLibrary()
    await clearStoredTracks()
    for (const url of urlCacheRef.current.values()) URL.revokeObjectURL(url)
    urlCacheRef.current.clear()
    for (const info of thumbCacheRef.current.values()) {
      if (info) URL.revokeObjectURL(info.url)
    }
    thumbCacheRef.current.clear()
    fileMapRef.current.clear()
    handlesRef.current.clear()
    setItems([])
    setSources([])
    setTracks([])
    setSelectedTrackId(null)
    setSearchQuery('')
    setGrantedIds(new Set())
    setViewer(null)
    setViewerAutoPlay(false)
    setSkipped(0)
    setSkippedNames([])
    setCachedCount(0)
    setError('Kütüphane temizlendi.', 'info')
  }, [])

  const sourceHandleIds = new Set(handlesRef.current.keys())
  const hasDisconnectedSources = sources.some((s) =>
    sourceNeedsReconnect(
      s,
      sources,
      grantedIds,
      localOnlineIds,
      localAvailabilityReady,
      sourceHandleIds,
    ),
  )

  const addRideFiles = useCallback(async (files: FileList | File[] | null) => {
    const list = files ? (Array.isArray(files) ? files : Array.from(files)) : []
    const trackFiles = list.filter((f) => isTrackFileName(f.name))
    if (trackFiles.length === 0) {
      setError('GPX, KML veya KMZ dosyası seç.')
      return
    }
    const sourceId = `ride-${Date.now()}`
    const parsed: MapTrack[] = []
    for (const file of trackFiles) {
      const track = await parseTrackFile(file, sourceId)
      if (track) parsed.push(track)
    }
    if (parsed.length === 0) {
      setError('GPX/KML/KMZ okunamadı veya yeterli nokta yok.')
      return
    }
    setTracks((prev) => [...prev, ...parsed])
    setRidesOpen(true)
    setSelectedTrackId(parsed[0].id)
    setPinItems(null)
    setShowLocationMissing(false)
    setError(`${parsed.length} ride dosyası eklendi.`, 'info')
  }, [])

  const selectRideTrack = useCallback((track: MapTrack) => {
    const range = trackDateRange(track)
    const dated = itemsOnTrackDates(
      itemsRef.current.filter((i) => !i.locationMissing),
      track,
    )
    const dates = formatTrackDateRange(track)
    pinLockRef.current = Date.now()
    startTransition(() => {
      setSelectedTrackId(track.id)
      setPinItems(null)
      setGalleryScope('area')
      setShowLocationMissing(false)
      // Odak: yalnızca bu ride çizilsin + ride tarihlerindeki medya
      setTracks((prev) =>
        prev.map((t) => ({
          ...t,
          visible: t.id === track.id,
        })),
      )
    })
    if (!range) {
      setError(
        `"${track.name}" içinde zaman yok — tarih filtresi uygulanamadı.`,
      )
    } else {
      setError(
        `"${track.name}" · ${dates} · ${dated.length} medya`,
        'info',
      )
    }
  }, [setError])

  const clearRideSelection = useCallback(() => {
    setSelectedTrackId(null)
    setError('Ride odağı kaldırıldı — tüm işaretli güzergahlar / medya.', 'info')
  }, [setError])

  const goToPlace = useCallback((place: PlaceHit) => {
    pinLockRef.current = Date.now()
    setFlyTo({
      id: `${place.id}-${Date.now()}`,
      latitude: place.latitude,
      longitude: place.longitude,
      bbox: place.bbox,
    })
    // Yer adına gitmek dosya adı filtresi değildir — aksi halde
    // "bulgaristan" yazınca GPS medya 0 kalır (dosya adında geçmez).
    setSearchInput('')
    setSearchQuery('')
    setPlaceHits([])
    setPlaceSearchOpen(false)
    setSelectedTrackId(null)
    setPinItems(null)
    setShowLocationMissing(false)
    setGalleryScope('area')
    setError(`Konum: ${place.label}`, 'info')
  }, [])

  const searchMediaMatchCount = useMemo(() => {
    const q = searchQuery.trim()
    if (!q) return 0
    return availableItems.filter((item) => {
      const sourceLabel = sources.find((s) => s.id === item.sourceId)?.label
      return itemMatchesQuery(item, q, sourceLabel)
    }).length
  }, [availableItems, searchQuery, sources])

  const filteredRides = useMemo(() => {
    const needle = normalizeSearchText(searchQuery)
    if (!needle) return tracks
    return tracks.filter((t) =>
      matchesMediaSearch(normalizeSearchText(t.name), needle),
    )
  }, [tracks, searchQuery])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <p className="brand__mark">
             {editionLabel(appEdition)}{' '}
             <span className="brand__version">v{__APP_VERSION__}</span>
          </p>
          <p className="brand__tag">
            {editionV2
              ? 'Tarayıcıda GPS medya haritan — kurulum yok'
              : 'Dünya haritasında medya izlerin'}
          </p>
          {editionV2 && showDriveAdd && !localApiAvailable && !busy && (
            <p className="brand__api-hint" role="status">
              {items.length > 0 ? (
                <>
                  Önbellek görüntüleniyor — yeni tarama / GPS yeniden deneme için{' '}
                  <code>baslat-v2.bat</code> ve <code>http://127.0.0.1:5183</code>.
                </>
              ) : (
                <>
                  Yerel API kapalı — sürücü eklemek için{' '}
                  <code>baslat-v2.bat</code> ve{' '}
                  <code>http://127.0.0.1:5183</code> (5173 değil).
                </>
              )}
            </p>
          )}
        </div>

        <div className="topbar__actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setSettingsOpen(true)}
          >
            {language === 'en' ? 'Settings' : 'Ayarlar'}
          </button>
          {busy ? (
            <button
              type="button"
              className="btn btn--danger"
              onClick={cancelScan}
              title="Tüm taramaları durdur"
            >
              İptal
            </button>
          ) : null}
          <input
            ref={folderInputRef}
            type="file"
            hidden
            multiple
            onChange={(e) => {
              const files = e.target.files
              const id = `pick-${Date.now()}`
              if (files && files.length > 0) {
                void putSource({
                  id,
                  label: files.length === 1 ? files[0].name : `${files.length} dosya`,
                  addedAt: Date.now(),
                })
                setSources((prev) => [
                  ...prev.filter((s) => s.id !== id),
                  {
                    id,
                    label: files.length === 1 ? files[0].name : `${files.length} dosya`,
                    addedAt: Date.now(),
                  },
                ])
                void ingest(files, id, true)
              }
              e.target.value = ''
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            hidden
            multiple
            accept="image/*,video/*,.heic,.heif,.mov,.mp4,.m4v"
            onChange={(e) => {
              const files = e.target.files
              const id = `pick-${Date.now()}`
              if (files && files.length > 0) {
                void putSource({
                  id,
                  label: files.length === 1 ? files[0].name : `${files.length} dosya`,
                  addedAt: Date.now(),
                })
                setSources((prev) => [
                  ...prev.filter((s) => s.id !== id),
                  {
                    id,
                    label: files.length === 1 ? files[0].name : `${files.length} dosya`,
                    addedAt: Date.now(),
                  },
                ])
                void ingest(files, id, true)
              }
              e.target.value = ''
            }}
          />
          <input
            ref={rideFileInputRef}
            type="file"
            hidden
            multiple
            accept=".gpx,.kml,.kmz,application/gpx+xml,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
            onChange={(e) => {
              void addRideFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
      </header>

      <div className="media-filters" aria-label="Medya türü filtresi">
        {editionV2 && (
          <div className="search-field" ref={searchFieldRef}>
            <label className="search-field__label">
              <span className="visually-hidden">Dosya veya konum ara</span>
              <input
                type="search"
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value)
                  setPlaceSearchOpen(true)
                }}
                onFocus={() => {
                  if (searchInput.trim().length >= 2 || placeHits.length > 0) {
                    setPlaceSearchOpen(true)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setPlaceSearchOpen(false)
                    ;(e.target as HTMLInputElement).blur()
                  }
                  if (e.key === 'Enter' && placeHits[0]) {
                    e.preventDefault()
                    goToPlace(placeHits[0])
                  }
                }}
                placeholder="Dosya veya konum ara…"
                aria-label="Dosya veya konum ara"
                aria-autocomplete="list"
                aria-expanded={placeSearchOpen}
              />
            </label>
            {placeSearchOpen && searchInput.trim().length >= 2 && (
              <div className="search-suggest" role="listbox">
                {searchMediaMatchCount > 0 && (
                  <p className="search-suggest__hint">
                    {searchMediaMatchCount} medya dosyası eşleşiyor
                  </p>
                )}
                {filteredRides.length > 0 && searchQuery.trim() && (
                  <p className="search-suggest__hint">
                    {filteredRides.length} ride dosyası eşleşiyor
                  </p>
                )}
                {placeSearching && (
                  <p className="search-suggest__hint">Konum aranıyor…</p>
                )}
                {!placeSearching && placeHits.length === 0 && searchMediaMatchCount === 0 && (
                  <p className="search-suggest__hint">Konum bulunamadı</p>
                )}
                {placeHits.map((place) => (
                  <button
                    key={place.id}
                    type="button"
                    className="search-suggest__item"
                    role="option"
                    onClick={() => goToPlace(place)}
                  >
                    <span className="search-suggest__kind">Konum</span>
                    <span className="search-suggest__label">{place.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div
          className={`sources-panel sources-panel--inline ${sourcesOpen ? 'is-open' : 'is-collapsed'}`}
          ref={sourcesMenuRef}
        >
          <header className="sources-panel__head">
            <button
              type="button"
              className="sources-panel__toggle"
              onClick={() => {
                setRidesOpen(false)
                setSourcesOpen((open) => !open)
              }}
              aria-expanded={sourcesOpen}
              title={sourcesOpen ? 'Kaynakları gizle' : 'Kaynakları göster'}
            >
              <span className="sources-panel__title">Medya kaynakları</span>
              <span className="sources-menu__count">
                {sources.length === 0
                  ? '0'
                  : `${visibleSourceCount}/${sources.length}`}
              </span>
              <span className="sources-panel__caret" aria-hidden>
                {sourcesOpen ? '▾' : '▴'}
              </span>
            </button>
          </header>

          {sourcesOpen && (
            <div className="sources-panel__body">
              {sources.length === 0 ? (
                <p className="sources-menu__hint">
                  {showDriveAdd
                    ? 'Henüz kaynak yok. Klasör, dosya veya tek sürücü ekle.'
                    : 'Henüz kaynak yok. Klasör veya dosya ekle — tarayıcıda kalır.'}
                </p>
              ) : (
                topLevelSources.map((top) => {
                    if (top.isAnchor) return renderSourceRow(top, false)
                    const children = sources.filter(
                      (c) => c.parentId === top.id,
                    )
                    return (
                      <div key={top.id}>
                        {renderSourceRow(top, false)}
                        {children.map((child) =>
                          renderSourceRow(child, true),
                        )}
                      </div>
                    )
                  })
              )}
              <div className="sources-panel__actions">
                <button
                  type="button"
                  className="sources-menu__drive-btn"
                  onClick={() => void addFolderSmart()}
                >
                  + Klasör ekle
                </button>
                <button
                  type="button"
                  className="sources-menu__drive-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  + Dosya seç
                </button>
                {showDriveAdd && (
                  <button
                    type="button"
                    className="sources-menu__action-btn"
                    onClick={() => setDriveDialogOpen(true)}
                    title="Tek sürücü ekle ve tara"
                  >
                    + Sürücü ekle
                  </button>
                )}
                {hasDisconnectedSources && (
                  <button
                    type="button"
                    className="sources-menu__action-btn"
                    onClick={() => void reconnectAllDisconnected()}
                    disabled={reconnectingAll}
                    title={
                      language === 'en'
                        ? 'Reconnect all offline sources'
                        : 'Bağlı olmayan tüm kaynaklara yeniden bağlan'
                    }
                  >
                    {reconnectingAll
                      ? language === 'en'
                        ? 'Connecting…'
                        : 'Bağlanıyor…'
                      : language === 'en'
                        ? 'Connect all'
                        : 'Tümünü bağla'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div
          className={`sources-panel sources-panel--inline ${ridesOpen ? 'is-open' : 'is-collapsed'}`}
          ref={ridesMenuRef}
        >
          <header className="sources-panel__head">
            <button
              type="button"
              className="sources-panel__toggle"
              onClick={() => {
                setSourcesOpen(false)
                setRidesOpen((open) => !open)
              }}
              aria-expanded={ridesOpen}
              title={ridesOpen ? 'Ride dosyalarını gizle' : 'Ride dosyalarını göster'}
            >
              <span className="sources-panel__title">Ride Dosyaları</span>
              <span className="sources-menu__count">{tracks.length}</span>
              <span className="sources-panel__caret" aria-hidden>
                {ridesOpen ? '▾' : '▴'}
              </span>
            </button>
          </header>

          {ridesOpen && (
            <div className="sources-panel__body">
              {tracks.length === 0 ? (
                <p className="sources-menu__hint">
                  GPX / KML / KMZ ekle (ad = dosya adı). İsme tıkla: yalnızca o
                  ride + ride tarihlerindeki medya. Kutu: çizgi göster/gizle.
                </p>
              ) : filteredRides.length === 0 ? (
                <p className="sources-menu__hint">
                  Aramayla eşleşen ride dosyası yok.
                </p>
              ) : (
                <ul className="ride-list">
                  {filteredRides.map((track) => {
                    const active = track.id === selectedTrackId
                    const marked = track.visible === true
                    const dates = formatTrackDateRange(track)
                    return (
                      <li
                        key={track.id}
                        className={`ride-row ${active ? 'is-active' : ''} ${marked ? '' : 'is-hidden'}`}
                      >
                        <label className="ride-row__check" title="Haritada göster">
                          <input
                            type="checkbox"
                            checked={marked}
                            onChange={() => {
                              const next = !marked
                              setTracks((prev) =>
                                prev.map((t) =>
                                  t.id === track.id ? { ...t, visible: next } : t,
                                ),
                              )
                              if (!next && selectedTrackId === track.id) {
                                setSelectedTrackId(null)
                              }
                            }}
                          />
                          <span className="visually-hidden">Haritada göster</span>
                        </label>
                        <button
                          type="button"
                          className="ride-row__main"
                          onClick={() => selectRideTrack(track)}
                          title="Bu ride + tarihlerindeki medya"
                        >
                          <span className="ride-row__name">{track.name}</span>
                          <span className="ride-row__meta">
                            {(track.pointCount ?? track.points.length).toLocaleString('tr-TR')} nokta
                            {dates ? ` · ${dates}` : ''}
                            {active && trackFocusItems
                              ? ` · ${trackFocusItems.length} medya`
                              : ''}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="source-row__btn source-row__btn--icon source-row__btn--x"
                          title="Ride dosyasını kaldır"
                          onClick={() => {
                            setTracks((prev) => prev.filter((t) => t.id !== track.id))
                            if (selectedTrackId === track.id) setSelectedTrackId(null)
                          }}
                        >
                          ×
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className="sources-panel__actions">
                <button
                  type="button"
                  className="sources-menu__drive-btn"
                  onClick={() => rideFileInputRef.current?.click()}
                >
                  + GPX / KML / KMZ ekle
                </button>
                {selectedTrackId && (
                  <button
                    type="button"
                    className="sources-menu__action-btn"
                    onClick={clearRideSelection}
                  >
                    Güzergah seçimini kaldır
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="location-filters" ref={typesMenuRef}>
        <button
          type="button"
          className={`types-menu__toggle ${typeMenuLocation === 'located' ? 'is-open' : ''}`}
          onClick={() => {
            setShowLocationMissing(false)
            setTypeMenuLocation((current) =>
              current === 'located' ? null : 'located',
            )
          }}
          title={
            language === 'en'
              ? 'Library: media with GPS on the map'
              : 'Kütüphane: haritadaki GPS konumlu medyalar'
          }
        >
          {language === 'en' ? 'GPS located' : 'GPS konumlu'}
          <span className="sources-menu__count">
            {locatedCount}
          </span>
        </button>
        <button
          type="button"
          className={`types-menu__toggle ${typeMenuLocation === 'missing' ? 'is-open' : ''}`}
          onClick={() => {
            setShowLocationMissing(true)
            setTypeMenuLocation((current) =>
              current === 'missing' ? null : 'missing',
            )
          }}
          title={
            language === 'en'
              ? 'Library: media without a GPS location'
              : 'Kütüphane: GPS konumu bulunamayan medyalar'
          }
        >
          {language === 'en' ? 'Location missing' : 'Konum bulunamayan'}
          <span className="sources-menu__count">
            {missingLocationCount}
          </span>
        </button>
        {missingLocationCount > 0 && (
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || !localApiAvailable}
            title={
              localApiAvailable
                ? 'Konumu bulunamayan medyalarda GPS’i yeniden oku (tam tarama yok)'
                : 'GPS yeniden deneme için yerel API gerekir (baslat-v2.bat → 5183)'
            }
            onClick={() => void retryMissingGps()}
          >
            {language === 'en' ? 'Retry missing GPS' : 'Konum yokları yeniden dene'}
          </button>
        )}

        <div className="types-menu">
          <button
            type="button"
            hidden
            className={`types-menu__toggle ${typeMenuLocation ? 'is-open' : ''}`}
            onClick={() => {
              setTypeMenuLocation((current) => current ? null : 'located')
            }}
            aria-expanded={Boolean(typeMenuLocation)}
          >
            Medya türleri
            <span className="sources-menu__count">
              {enabledKinds.size}/{ALL_KINDS.length}
            </span>
            <span className="sources-menu__caret" aria-hidden>
              ▾
            </span>
          </button>

          {typeMenuLocation && (
            <div className="types-menu__panel">
              {(
                [
                  ['photo', 'Fotoğraflar'],
                  ['video', 'Telefon videoları'],
                  ['gopro', 'GoPro'],
                  ['drone', 'DJI / Drone videoları'],
                ] as const
              ).map(([kind, label]) => {
                const count = availableItems.filter(
                  (item) =>
                    item.kind === kind &&
                    (typeMenuLocation === 'missing'
                      ? item.locationMissing
                      : !item.locationMissing),
                ).length
                const on = enabledKinds.has(kind)
                return (
                  <label
                    key={kind}
                    className={`types-menu__row${on ? '' : ' is-off'}`}
                    title={
                      on
                        ? count === 0
                          ? 'Filtre açık — kütüphanede bu tür yok; sürücüyü ↻ ile yeniden tara'
                          : undefined
                        : 'Kapalı — işaretle; sonraki taramada okunur ve haritada gösterilir'
                    }
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleKind(kind)}
                    />
                    <span
                      className={`media-filter__dot kind-${kind}`}
                      aria-hidden
                    />
                    <span className="types-menu__label">{label}</span>
                    <span
                      className="types-menu__count"
                      title="Haritadaki alanda görünen sayı"
                    >
                      {count}
                    </span>
                  </label>
                )
              })}
              <p className="types-menu__hint">
                İşaretli türler gösterilir ve sonraki taramada okunur. Sayı 0 olsa
                da kutuyu açıp kapatabilirsin.
              </p>
            </div>
          )}
        </div>
        </div>
        <button
          type="button"
          className={`types-menu__toggle ${showLocationMissing ? 'is-open' : ''}`}
          hidden
          onClick={() => setShowLocationMissing((value) => !value)}
          title="GPS konumu bulunamayan medyaları göster"
        >
          Konumu bulunamayan
          <span className="sources-menu__count">
            {missingLocationCount}
          </span>
        </button>
        <span className="media-filters__hint">
          Geliştiren Ali Dinçer
        </span>
      </div>

      {(busy || items.length > 0) && (
        <div className="status">
          {busy && (
            <p>
              {(() => {
                const done = [...scans.values()].reduce((sum, p) => sum + p.done, 0)
                const total = [...scans.values()].reduce((sum, p) => sum + p.total, 0)
                const located = [...scans.values()].reduce(
                  (sum, p) => sum + (p.located ?? 0),
                  0,
                )
                const missing = [...scans.values()].reduce(
                  (sum, p) => sum + (p.missing ?? 0),
                  0,
                )
                if (total <= 0) {
                  return (
                    <>
                      {scans.size > 1
                        ? `${scans.size} kaynakta dosyalar aranıyor…`
                        : 'Dosyalar aranıyor…'}
                      <span className="status__hint"> — durdurmak için İptal</span>
                    </>
                  )
                }
                if (done === 0) {
                  return (
                    <>
                      Dosyalar aranıyor… {total} medya bulundu
                      <span className="status__hint"> — durdurmak için İptal</span>
                    </>
                  )
                }
                return (
                  <>
                    {scans.size > 1 ? `${scans.size} kaynak okunuyor… ` : 'Konum Bulucu okuyor… '}
                    {done}/{total}
                    {' · '}Bu tarama: {located} konum
                    {' · '}{missing} yok
                    <span className="status__hint"> — durdurmak için İptal</span>
                  </>
                )
              })()}
            </p>
          )}
          {!busy && items.length > 0 && (
            <p>
              {availableItems.length !== items.length
                ? `Gösterilen ${availableItems.length} / `
                : ''}
              Toplam {items.length} medya · {locatedCount} GPS'li dosya
              {' · '}{locationCount} benzersiz konum
              {missingLocationCount > 0
                ? ` · ${missingLocationCount} dosyada GPS yok`
                : ''}
              {cachedCount > 0 ? ` · ${cachedCount} hafızadan` : ''}
            </p>
          )}
          {!busy && skippedNames.length > 0 && items.length === 0 && (
            <p className="status__hint">
              GPS bulunamayanlar: {skippedNames.slice(0, 8).join(', ')}
              {skippedNames.length > 8 ? ` +${skippedNames.length - 8}` : ''}
            </p>
          )}
        </div>
      )}

      {error && (
        <div
          className="flash-toast-backdrop"
          role="presentation"
          onMouseDown={() => setError(null)}
        >
          <div
            className={`flash-toast flash-toast--${toastKind}`}
            role="alert"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p>{error}</p>
          </div>
        </div>
      )}

      <main className="content">
        <div className="stage">
          <WorldMap
            clusters={clusters}
            tracks={tracks}
            selectedTrackId={selectedTrackId}
            flyTo={flyTo}
            onBoundsChange={(bounds) => {
              setMapBounds(bounds)
              if (Date.now() - pinLockRef.current > 900) {
                setPinItems(null)
              }
            }}
            onClusterSelect={(clusterItems) => {
              pinLockRef.current = Date.now()
              setPinItems(clusterItems)
              setSelectedTrackId(null)
              setGalleryScope('area')
              setShowLocationMissing(false)
            }}
            onTrackSelect={selectRideTrack}
            focusPoint={focusPoint}
          />
          {items.length > 0 && (
            <div
              className="map-count"
              title={
                selectedTrack
                  ? `Seçili güzergah: ${selectedTrack.name}`
                  : pinItems
                    ? 'Seçili konumdaki medya'
                    : `${locatedCount} GPS'li dosya · ${locationCount} benzersiz konum`
              }
            >
              <strong>{visibleInArea}</strong>{' '}
              {selectedTrack && !pinItems
                ? 'görüntü bu tarihlerde'
                : pinItems
                  ? 'görüntü bu konumda'
                  : 'görüntü bu alanda'}
            </div>
          )}
          {items.length === 0 && !busy && (
            <div className="empty-overlay">
              <h1>Haritada medyalarını göster</h1>
              <p>
                GPS’li fotoğraf veya video eklemek için Medya kaynakları menüsünü
                kullan. Ride Dosyaları ile GPX/KML/KMZ güzergah ekleyebilirsin.
              </p>
              <div className="empty-overlay__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    setRidesOpen(false)
                    setSourcesOpen(true)
                  }}
                >
                  Medya kaynakları
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setSourcesOpen(false)
                    setRidesOpen(true)
                  }}
                >
                  Ride Dosyaları
                </button>
              </div>
            </div>
          )}

        </div>

        <MediaGallery
          items={galleryItems}
          listKey={
            selectedTrackId
              ? `ride-${selectedTrackId}-${trackFocusItems?.length ?? 0}`
              : pinItems
                ? `pin-${pinItems[0]?.id ?? ''}-${pinItems.length}`
                : `area-${galleryScope}-${showLocationMissing ? 'missing' : 'located'}-${mapBounds?.west?.toFixed(3) ?? ''}-${mapBounds?.north?.toFixed(3) ?? ''}`
          }
          totalLocated={locatedCount}
          locationMode={showLocationMissing ? 'missing' : 'located'}
          language={language}
          scope={galleryScope}
          onScopeChange={(next) => {
            setPinItems(null)
            setSelectedTrackId(null)
            setGalleryScope(next)
          }}
            areaHint={
            selectedTrack && !pinItems
              ? `ride tarihleri: ${formatTrackDateRange(selectedTrack) ?? selectedTrack.name}`
              : pinItems
                ? 'seçili konum'
                : undefined
          }
          selectedId={focusedItemId}
          resolveThumb={resolveThumb}
          pathForItem={pathForItem}
          onSelect={(item) => {
            setFocusedItemId(item.id)
            if (item.locationMissing) {
              setError(
                item.gpsExtractFailed
                  ? 'GPS okunamadı (API/IO). “Konum yokları yeniden dene” veya baslat-v2.bat.'
                  : 'Bu medyada GPS konumu yok.',
                'info',
              )
            }
          }}
          onOpen={(item, opts) => {
            setError(null)
            setFocusedItemId(item.id)
            setViewerAutoPlay(Boolean(opts?.autoPlay))
            setViewer(item)
          }}
          onReconnect={reconnectSource}
          onCopyPath={copyItemPath}
        />
      </main>

      <Lightbox
        item={viewer}
        autoPlay={viewerAutoPlay}
        resolveUrl={resolveUrl}
        revealInFolder={showDesktopSources ? revealInFolder : undefined}
        playExternally={showDesktopSources ? playExternally : undefined}
        stopPreview={showDesktopSources ? stopPreview : undefined}
        onClose={() => {
          setError(null)
          setViewer(null)
          setViewerAutoPlay(false)
        }}
      />

      {sessionResume && (
        <div
          className="notice-backdrop"
          role="presentation"
          onMouseDown={() =>
            dismissSessionResume(setSessionResume, sessionResumeHandledRef)
          }
        >
          <section
            className="notice-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-resume-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="notice-dialog__icon" aria-hidden>
              ↩
            </span>
            <div>
              <h2 id="session-resume-title">Son çalışmanız bulundu</h2>
              <p>
                {sessionResume.itemCount} medya
                {sessionResume.driveCount > 0
                  ? ` · ${sessionResume.driveCount} sürücü`
                  : sessionResume.sourceCount > 0
                    ? ` · ${sessionResume.sourceCount} kaynak`
                    : ''}{' '}
                bu cihazda kayıtlı. Devam etmek ister misiniz?
              </p>
            </div>
            <div className="notice-dialog__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  dismissSessionResume(setSessionResume, sessionResumeHandledRef)
                  void resetAll()
                }}
              >
                Yeni başla
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() =>
                  dismissSessionResume(setSessionResume, sessionResumeHandledRef)
                }
              >
                Devam
              </button>
            </div>
          </section>
        </div>
      )}

      {notice && (
        <div className="notice-backdrop" role="presentation" onMouseDown={() => setNotice(null)}>
          <section
            className={`notice-dialog${notice.stats?.length ? ' notice-dialog--report' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="scan-report-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="notice-dialog__icon" aria-hidden>✓</span>
            <div className="notice-dialog__body">
              <h2 id="scan-report-title">{notice.title}</h2>
              <p>{notice.message}</p>
              {notice.stats && notice.stats.length > 0 && (
                <ul className="notice-dialog__stats">
                  {notice.stats.map((row) => (
                    <li key={row.label}>
                      <span>{row.label}</span>
                      <strong>{row.value}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {notice.stats?.length ? (
              <div className="notice-dialog__actions">
                <button type="button" className="btn btn--primary" onClick={() => setNotice(null)}>
                  Tamam
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn--primary" onClick={() => setNotice(null)}>
                Tamam
              </button>
            )}
          </section>
        </div>
      )}

      {driveDialogOpen && (
        <div className="notice-backdrop" role="presentation" onMouseDown={() => setDriveDialogOpen(false)}>
          <form
            className="drive-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              const path = drivePath.trim()
              if (!path) {
                setError('Sürücü seçilmedi.')
                return
              }
              if (!localApiAvailable) {
                setError(localApiMissingHint(editionV2 ? 'v2' : 'v1'))
                return
              }
              const letter = driveLetterOf(path)
              const existing =
                letter
                  ? sourcesRef.current.find((source) => {
                      const root =
                        source.localPath ??
                        localPathForSource(source, sourcesRef.current)
                      return (
                        (source.isAnchor || isDriveRootPath(root)) &&
                        driveLetterOf(root) === letter
                      )
                    })
                  : undefined
              setDriveDialogOpen(false)
              if (existing) {
                setError(
                  `“${existing.label}” zaten ekli — yeniden taranıyor…`,
                  'info',
                )
                void scanLocalPath(
                  path,
                  existing.id,
                  driveLabel || existing.label,
                )
                return
              }
              void scanLocalPath(path, undefined, driveLabel || undefined)
            }}
          >
            <h2>Sürücü ekle</h2>
            <p>
              Listeden <strong>tek bir sürücü</strong> seç; MedyaAtlas yalnızca
              medya dosyalarını tarar ve önizlemeleri açar. Daha önce eklenmiş
              sürücüye tekrar tıklayınca yeniden tarar.
            </p>
            <label>Bağlı sürücüler</label>
            {drivesLoading && <p className="drive-dialog__status">Sürücüler okunuyor…</p>}
            {drivesError && (
              <p className="drive-dialog__status drive-dialog__status--error">
                {drivesError}
              </p>
            )}
            {!drivesLoading && !drivesError && availableDrives.length === 0 && (
              <p className="drive-dialog__status">Bağlı sürücü bulunamadı.</p>
            )}
            <div className="drive-dialog__list" role="listbox" aria-label="Sürücüler">
              {availableDrives.map((drive) => {
                const alreadyAdded = addedDriveLetters.has(drive.letter.toUpperCase())
                return (
                  <button
                    key={drive.path}
                    type="button"
                    role="option"
                    aria-selected={drivePath === drive.path}
                    className={[
                      'drive-dialog__drive',
                      alreadyAdded ? 'is-added' : '',
                      drivePath === drive.path ? 'is-selected' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => {
                      setDrivePath(drive.path)
                      setDriveLabel(drive.label)
                    }}
                    onDoubleClick={() => {
                      if (!localApiAvailable) {
                        setError(localApiMissingHint(editionV2 ? 'v2' : 'v1'))
                        return
                      }
                      setDrivePath(drive.path)
                      setDriveLabel(drive.label)
                      setDriveDialogOpen(false)
                      const existing = sourcesRef.current.find((source) => {
                        const root =
                          source.localPath ??
                          localPathForSource(source, sourcesRef.current)
                        return (
                          (source.isAnchor || isDriveRootPath(root)) &&
                          driveLetterOf(root) === drive.letter.toUpperCase()
                        )
                      })
                      if (existing) {
                        setError(
                          `“${existing.label}” yeniden taranıyor…`,
                          'info',
                        )
                        void scanLocalPath(
                          drive.path,
                          existing.id,
                          drive.label || existing.label,
                        )
                      } else {
                        void scanLocalPath(drive.path, undefined, drive.label)
                      }
                    }}
                  >
                    <span className="drive-dialog__drive-name">{drive.label}</span>
                    <span className="drive-dialog__drive-meta">
                      {alreadyAdded ? (
                        <span className="drive-dialog__badge">Eklendi · yeniden tara</span>
                      ) : null}
                      <span className="drive-dialog__drive-path">{drive.path}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="drive-dialog__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setDriveDialogOpen(false)}>Vazgeç</button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={!drivePath.trim() || Boolean(drivesError) || drivesLoading}
              >
                {driveLetterOf(drivePath) &&
                addedDriveLetters.has(driveLetterOf(drivePath)!)
                  ? 'Yeniden tara'
                  : 'Sürücüyü ekle ve tara'}
              </button>
            </div>
          </form>
        </div>
      )}

      {settingsOpen && (
        <div
          className="settings-backdrop"
          role="presentation"
          onMouseDown={() => setSettingsOpen(false)}
        >
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="settings-dialog__head">
              <div>
                <p className="settings-dialog__eyebrow">
                  {language === 'en' ? 'MediaAtlas' : 'MedyaAtlas'}
                </p>
                <h2 id="settings-title">
                  {language === 'en' ? 'Settings' : 'Ayarlar'}
                </h2>
              </div>
              <button
                type="button"
                className="settings-dialog__close"
                onClick={() => setSettingsOpen(false)}
                aria-label={language === 'en' ? 'Close' : 'Kapat'}
              >
                ×
              </button>
            </header>

            <div className="settings-dialog__section">
              <label className="settings-dialog__label" htmlFor="language-select">
                {language === 'en' ? 'Language' : 'Dil'}
              </label>
              <select
                id="language-select"
                className="settings-dialog__select"
                value={language}
                onChange={(event) => {
                  const next = event.target.value === 'en' ? 'en' : 'tr'
                  setLanguage(next)
                  localStorage.setItem('mediaatlas-language', next)
                }}
              >
                <option value="tr">Türkçe</option>
                <option value="en">English</option>
              </select>
              <p className="settings-dialog__note">
                {language === 'en'
                  ? 'Main controls switch immediately. More labels will follow in the next beta updates.'
                  : 'Ana kontroller hemen değişir. Kalan metinler sonraki beta güncellemelerinde tamamlanacak.'}
              </p>
            </div>

            <div className="settings-dialog__section">
              <div className="settings-dialog__row">
                <div>
                  <h3>{language === 'en' ? 'Help' : 'Yardım'}</h3>
                  <p>{language === 'en' ? 'How sources and location filters work.' : 'Kaynakların ve konum filtrelerinin nasıl çalıştığı.'}</p>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setHelpOpen((open) => !open)}
                >
                  {helpOpen ? (language === 'en' ? 'Hide' : 'Gizle') : (language === 'en' ? 'Show' : 'Göster')}
                </button>
              </div>
              {helpOpen && (
                <ul className="settings-dialog__help">
                  <li>{language === 'en' ? 'Add a drive from Sources. Its folders are discovered automatically.' : 'Kaynaklar içinden sürücü ekle. Alt klasörler otomatik bulunur.'}</li>
                  <li>{language === 'en' ? 'GPS located media appears on the map; Location missing lists the remaining supported media.' : 'GPS konumlu medya haritada görünür; Konum bulunamayan, desteklenen diğer medyaları listeler.'}</li>
                  <li>{language === 'en' ? 'Drag the map to pan; use the mouse wheel or +/−/world buttons to zoom.' : 'Haritayı sürükleyerek taşı; tekerlek veya +/−/dünya düğmeleriyle yakınlaştır.'}</li>
                </ul>
              )}
            </div>

            <div className="settings-dialog__section settings-dialog__section--danger">
              <div className="settings-dialog__row">
                <div>
                  <h3>{language === 'en' ? 'Clear data' : 'Verileri temizle'}</h3>
                  <p>{language === 'en' ? 'Removes the local library, previews and saved sources from this browser.' : 'Bu tarayıcıdaki kütüphaneyi, önizlemeleri ve kayıtlı kaynakları siler.'}</p>
                </div>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => {
                    if (window.confirm(language === 'en' ? 'Clear all MediaAtlas data on this browser?' : 'Bu tarayıcıdaki tüm MedyaAtlas verileri silinsin mi?')) {
                      void resetAll()
                      setSettingsOpen(false)
                    }
                  }}
                >
                  {language === 'en' ? 'Clear data' : 'Verileri temizle'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
