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
  /** GPS etiketi bulunamadı; haritada değil ayrı galeride gösterilir. */
  locationMissing?: boolean
  /**
   * GoPro GPMF okuması API/IO yüzünden yapılamadı — kesin "konum yok" değil.
   * false = tarama tamamlandı, kilitli GPS yok; true/undefined(eski) = yeniden dene.
   */
  gpsExtractFailed?: boolean
}

export interface LocationCluster {
  id: string
  latitude: number
  longitude: number
  items: MediaItem[]
}
