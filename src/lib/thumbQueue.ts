/** Galeri thumb isteklerini sınırla — onlarca ffmpeg aynı anda API’yi kilitler. */

const MAX = 4
let active = 0
const waiting: Array<() => void> = []

async function acquire(): Promise<void> {
  if (active >= MAX) {
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  active += 1
}

function release(): void {
  active = Math.max(0, active - 1)
  waiting.shift()?.()
}

export async function withThumbSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}
