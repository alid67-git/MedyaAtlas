import MP4Box from 'mp4box'

interface Mp4Track {
  id: number
  codec: string
  type?: string
  name?: string
  created?: Date
  movie_duration?: number
  movie_timescale?: number
  nb_samples?: number
  timescale?: number
}

interface Mp4Info {
  tracks: Mp4Track[]
}

interface Mp4SampleMeta {
  offset: number
  size: number
  cts: number
  duration: number
  timescale?: number
}

interface Mp4Trak {
  samples: Mp4SampleMeta[]
}

interface Mp4File {
  onError?: (error: unknown) => void
  onReady?: (info: Mp4Info) => void
  appendBuffer: (buffer: ArrayBuffer & { fileStart?: number }) => number | undefined
  getTrackById: (id: number) => Mp4Trak | null
  stop?: () => void
  flush: () => void
}

interface Mp4BoxModule {
  /** keepMdatData=false → mdat gövdesi atlanır, mid-mdat box parse spam olmaz */
  createFile: (keepMdatData?: boolean) => Mp4File
}

export interface FastGpmfResult {
  rawData: Uint8Array
  timing: {
    videoDuration: number
    frameDuration: number
    start: Date
    samples: { cts: number; duration: number }[]
  }
}

export interface GpmdSampleTable {
  samples: Mp4SampleMeta[]
  timing: {
    videoDuration: number
    frameDuration: number
    start: Date
  }
}

const MOOV_CHUNK = 2 * 1024 * 1024
const MOOV_MAX_ITERS = 24
const HEAD_CHUNK = 256 * 1024

/** mp4box BoxParser Log.error → console.error spam (size=0 / type ' ') */
let boxParserSilenced = false
function silenceBoxParserLogs() {
  if (boxParserSilenced) return
  boxParserSilenced = true
  const orig = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    for (const a of args) {
      if (typeof a === 'string' && (a === '[BoxParser]' || a.includes('Unlimited box size'))) {
        return
      }
    }
    orig(...args)
  }
}

/**
 * Yalnızca moov + gpmd örnek tablosu. Video gövdesi okunmaz.
 * createFile(false) + nextParsePosition ile mdat atlanır.
 */
export async function loadGpmdSampleTable(
  file: File,
  signal?: AbortSignal,
): Promise<GpmdSampleTable> {
  silenceBoxParserLogs()
  const mp4 = (MP4Box as unknown as Mp4BoxModule).createFile(false)
  let settled = false
  let rejectResult: (error: unknown) => void = () => {}

  const result = new Promise<GpmdSampleTable>((resolve, reject) => {
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      mp4.stop?.()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    rejectResult = fail

    mp4.onError = fail
    mp4.onReady = (info) => {
      const metadata = info.tracks.find((track) => track.codec === 'gpmd')
      if (!metadata) {
        fail(new Error('GoPro telemetry track not found'))
        return
      }
      const trak = mp4.getTrackById(metadata.id)
      const raw = trak?.samples
      if (!raw?.length) {
        fail(new Error('GoPro telemetry samples empty'))
        return
      }

      const video = info.tracks.find((track) => track.type === 'video')
      let videoDuration = 0
      let frameDuration = 0
      if (video?.movie_duration && video.movie_timescale) {
        videoDuration = video.movie_duration / video.movie_timescale
        if (video.nb_samples) frameDuration = videoDuration / video.nb_samples
      }

      settled = true
      mp4.stop?.()
      resolve({
        samples: raw.map((s) => ({
          offset: s.offset,
          size: s.size,
          cts: s.cts,
          duration: s.duration,
          timescale: s.timescale || metadata.timescale || 1000,
        })),
        timing: {
          videoDuration,
          frameDuration,
          start:
            metadata.created instanceof Date
              ? metadata.created
              : new Date(file.lastModified),
        },
      })
    }
  })

  const feed = async () => {
    let iterations = 0
    const visited = new Set<number>()

    const appendAt = async (offset: number, end: number) => {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      const buffer = (await file.slice(offset, end).arrayBuffer()) as ArrayBuffer & {
        fileStart?: number
      }
      buffer.fileStart = offset
      return mp4.appendBuffer(buffer)
    }

    // Küçük dosya: tek parça
    if (file.size <= MOOV_CHUNK) {
      await appendAt(0, file.size)
      if (!settled) mp4.flush()
      if (!settled) rejectResult(new Error('GoPro moov not found'))
      return
    }

    // ftyp + mdat başlığı → nextParsePosition genelde moov'a zıplar
    let next: number | undefined = await appendAt(0, Math.min(HEAD_CHUNK, file.size))
    iterations += 1

    while (!settled && iterations < MOOV_MAX_ITERS) {
      const pos =
        typeof next === 'number' && next >= 0 ? next : file.size
      if (pos >= file.size) break
      if (visited.has(pos)) break
      visited.add(pos)
      const end = Math.min(pos + MOOV_CHUNK, file.size)
      next = await appendAt(pos, end)
      iterations += 1
    }

    if (!settled) mp4.flush()
    if (!settled) rejectResult(new Error('GoPro moov not found'))
  }

  void feed().catch(rejectResult)

  const watchdog = setTimeout(() => {
    rejectResult(new Error('GPMF moov timed out'))
  }, 12000)
  void result.finally(() => clearTimeout(watchdog)).catch(() => {})

  if (!signal) return result
  return Promise.race([
    result,
    new Promise<never>((_, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      )
    }),
  ])
}

/** Belirli gpmd örneklerini doğrudan disk/blob aralığından oku. */
export async function readGpmdSampleBytes(
  file: File,
  samples: Mp4SampleMeta[],
  startIdx: number,
  count: number,
  signal?: AbortSignal,
): Promise<FastGpmfResult | null> {
  const group: Mp4SampleMeta[] = []
  for (let i = 0; i < count && startIdx + i < samples.length; i += 1) {
    group.push(samples[startIdx + i])
  }
  if (!group.length) return null
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const first = group[0]
  const last = group[group.length - 1]
  const spanEnd = last.offset + last.size
  const contiguous = group.every((s, i) => {
    if (i === 0) return true
    const prev = group[i - 1]
    return s.offset === prev.offset + prev.size
  })

  let rawData: Uint8Array
  if (contiguous && spanEnd - first.offset <= 512 * 1024) {
    rawData = new Uint8Array(
      await file.slice(first.offset, spanEnd).arrayBuffer(),
    )
  } else {
    const parts: Uint8Array[] = []
    let total = 0
    for (const s of group) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const part = new Uint8Array(
        await file.slice(s.offset, s.offset + s.size).arrayBuffer(),
      )
      parts.push(part)
      total += part.length
    }
    rawData = new Uint8Array(total)
    let off = 0
    for (const p of parts) {
      rawData.set(p, off)
      off += p.length
    }
  }

  return {
    rawData,
    timing: {
      videoDuration: 0,
      frameDuration: 0,
      start: new Date(file.lastModified),
      samples: group.map((s) => ({ cts: s.cts, duration: s.duration })),
    },
  }
}

/**
 * Geriye dönük: seyrek sonda ilk geçerli telemetri dilimini döner.
 * Tercihen readGoProGps içindeki çoklu sonda kullanılır.
 */
export async function fastGpmfExtract(
  file: File,
  signal?: AbortSignal,
  sampleCount = 2,
): Promise<FastGpmfResult> {
  const table = await loadGpmdSampleTable(file, signal)
  const n = table.samples.length
  const idx = Math.min(n - 1, Math.max(0, Math.floor(0.4 * (n - 1))))
  const extracted = await readGpmdSampleBytes(
    file,
    table.samples,
    idx,
    Math.max(1, sampleCount),
    signal,
  )
  if (!extracted) throw new Error('GoPro telemetry not found')
  return {
    ...extracted,
    timing: {
      ...extracted.timing,
      videoDuration: table.timing.videoDuration,
      frameDuration: table.timing.frameDuration,
      start: table.timing.start,
    },
  }
}
