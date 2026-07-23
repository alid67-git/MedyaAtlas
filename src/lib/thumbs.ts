import type { MediaKind } from '../types'

const THUMB_WIDTH = 320
const JPEG_QUALITY = 0.72
const VIDEO_TIMEOUT_MS = 15000

export interface GeneratedThumb {
  blob: Blob
  durationSec?: number
}

// Aynı anda en fazla 2 üretim: sayfa donmaz, sıradakiler bekler.
const MAX_CONCURRENT = 2
let active = 0
const waiting: Array<() => void> = []

async function acquire(): Promise<void> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  active += 1
}

function release(): void {
  active -= 1
  waiting.shift()?.()
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  )
}

function drawScaled(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const scale = Math.min(1, THUMB_WIDTH / width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

async function makeVideoThumb(file: File): Promise<GeneratedThumb | null> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'metadata'

  try {
    const loaded = new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('video load failed'))
    })
    video.src = url
    await Promise.race([
      loaded,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('video load timeout')), VIDEO_TIMEOUT_MS),
      ),
    ])

    const durationSec = Number.isFinite(video.duration)
      ? video.duration
      : undefined

    // İlk karelere yakın bir nokta: hızlı seek, temsili görüntü
    const seeked = new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve()
      video.onerror = () => reject(new Error('video seek failed'))
    })
    video.currentTime = Math.min(0.5, (video.duration || 1) / 2)
    await Promise.race([
      seeked,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('video seek timeout')), VIDEO_TIMEOUT_MS),
      ),
    ])

    if (!video.videoWidth || !video.videoHeight) return null
    const canvas = drawScaled(video, video.videoWidth, video.videoHeight)
    const blob = await canvasToJpeg(canvas)
    return blob ? { blob, durationSec } : null
  } catch {
    return null
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

async function makeImageThumb(file: File): Promise<GeneratedThumb | null> {
  try {
    const bitmap = await createImageBitmap(file)
    try {
      const canvas = drawScaled(bitmap, bitmap.width, bitmap.height)
      const blob = await canvasToJpeg(canvas)
      return blob ? { blob } : null
    } finally {
      bitmap.close()
    }
  } catch {
    // HEIC gibi tarayıcının çözemediği biçimler
    return null
  }
}

/** Dosyadan küçük JPEG önizleme üretir (kuyruklu, en fazla 2 eşzamanlı). */
export async function generateThumb(
  file: File,
  kind: MediaKind,
): Promise<GeneratedThumb | null> {
  await acquire()
  try {
    return kind === 'photo' ? await makeImageThumb(file) : await makeVideoThumb(file)
  } finally {
    release()
  }
}
