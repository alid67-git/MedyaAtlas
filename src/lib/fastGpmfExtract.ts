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
}

interface Mp4Info {
  tracks: Mp4Track[]
}

interface Mp4Sample {
  data: Uint8Array
  size: number
  cts: number
  duration: number
}

interface Mp4File {
  onError?: (error: unknown) => void
  onReady?: (info: Mp4Info) => void
  onSamples?: (
    id: number,
    user: unknown,
    samples: Mp4Sample[],
  ) => void
  appendBuffer: (buffer: ArrayBuffer & { fileStart?: number }) => number | undefined
  setExtractionOptions: (
    id: number,
    user: unknown,
    options: { nbSamples: number },
  ) => void
  start: () => void
  stop?: () => void
  flush: () => void
}

interface Mp4BoxModule {
  createFile: () => Mp4File
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

/**
 * MP4'ün tamamını okumadan ilk N GPMF telemetri örneğini çıkarır.
 * MP4Box gerekli byte aralıklarına atlar; büyük video gövdesini taramaz.
 */
export async function fastGpmfExtract(
  file: File,
  signal?: AbortSignal,
  sampleCount = 1,
): Promise<FastGpmfResult> {
  const mp4 = (MP4Box as unknown as Mp4BoxModule).createFile()
  const chunkSize = 1024 * 1024
  const target = Math.max(1, sampleCount)
  let settled = false
  let videoDuration = 0
  let frameDuration = 0
  let start = new Date(file.lastModified)
  let rejectResult: (error: unknown) => void = () => {}
  let finishRef: () => void = () => {}

  const result = new Promise<FastGpmfResult>((resolve, reject) => {
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
      const video = info.tracks.find((track) => track.type === 'video')

      if (!metadata) {
        fail(new Error('GoPro telemetry track not found'))
        return
      }

      if (metadata.created instanceof Date) start = metadata.created
      if (video?.movie_duration && video.movie_timescale) {
        videoDuration = video.movie_duration / video.movie_timescale
        if (video.nb_samples) frameDuration = videoDuration / video.nb_samples
      }

      // Hedef kadar örneği tek seferde iste; tek tek çekmek HDD'yi öldürür.
      mp4.setExtractionOptions(metadata.id, null, { nbSamples: target })
      mp4.start()
    }

    const collected: Mp4Sample[] = []

    const finish = () => {
      if (settled || collected.length === 0) return
      settled = true
      mp4.stop?.()

      const total = collected.reduce((sum, sample) => sum + sample.size, 0)
      const rawData = new Uint8Array(total)
      let offset = 0
      for (const sample of collected) {
        rawData.set(sample.data, offset)
        offset += sample.size
      }

      resolve({
        rawData,
        timing: {
          videoDuration,
          frameDuration,
          start,
          samples: collected.map((sample) => ({
            cts: sample.cts,
            duration: sample.duration,
          })),
        },
      })
    }
    finishRef = finish

    mp4.onSamples = (_id, _user, samples) => {
      if (settled || samples.length === 0) return
      collected.push(...samples)
      if (collected.length >= target) finish()
    }
  })

  const feed = async () => {
    let offset = 0
    let iterations = 0
    // İlk N GPMF örneği genelde dosyanın başındaki birkaç MB'de; aşırı döngü gerekmez.
    const maxIterations = Math.min(80, 24 + target)

    while (!settled && offset < file.size && iterations < maxIterations) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }

      const end = Math.min(offset + chunkSize, file.size)
      const buffer = (await file.slice(offset, end).arrayBuffer()) as ArrayBuffer & {
        fileStart?: number
      }
      buffer.fileStart = offset
      const requested = mp4.appendBuffer(buffer)
      iterations += 1

      // MP4Box çoğunlukla doğrudan gerekli moov/GPMF aralığına atlar.
      offset =
        typeof requested === 'number' && requested >= 0 && requested !== offset
          ? requested
          : end
    }

    if (!settled) {
      mp4.flush()
    }

    // Dosya bitti: hedefe ulaşılamadıysa eldekilerle dön;
    // hiç örnek yoksa telemetri yok say, asla asılı kalma.
    if (!settled) {
      finishRef()
    }
    if (!settled) {
      rejectResult(new Error('GoPro telemetry not found'))
    }
  }

  void feed().catch(rejectResult)

  // Güvenlik ağı: tek dosya en fazla 12 sn tutabilir.
  const watchdog = setTimeout(() => {
    rejectResult(new Error('GPMF extraction timed out'))
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
