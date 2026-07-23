export type MediaKind = 'photo' | 'video' | 'gopro' | 'drone'

export interface MediaItem {
  id: string
  name: string
  /** Kaynak kök klasöre göreli yol (dosyayı yeniden çözmek için). */
  relativePath: string
  /** Bu medyanın ait olduğu kaynak (disk/klasör) kimliği. */
  sourceId: string
  kind: MediaKind
  /** Tembel çözülen blob URL. Kaynak bağlı değilken tanımsız olabilir. */
  url?: string
  /** Kaynak şu an erişilebilir mi (disk takılı + izin verili). */
  available: boolean
  latitude: number
  longitude: number
  takenAt?: Date
  width?: number
  height?: number
}

export interface LocationCluster {
  id: string
  latitude: number
  longitude: number
  items: MediaItem[]
}
