import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'
import type { LocationCluster } from '../types'
import { KIND_LABEL } from '../lib/media'
import 'leaflet/dist/leaflet.css'

export interface MapBounds {
  north: number
  south: number
  east: number
  west: number
}

/** Google Haritalar tarzı yoğunluk noktası: çok medya = daha büyük ve sıcak. */
function makeDotIcon(count: number) {
  const size = Math.min(44, 14 + Math.round(Math.sqrt(count) * 5))
  const heat = Math.min(1, count / 15)
  return L.divIcon({
    className: 'map-dot',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div class="map-dot__body" style="--dot-size:${size}px;--dot-heat:${heat}"></div>`,
  })
}

/** Uzak görünümde her konumda yanıp sönen parlak işaret; tek video bile kaybolmaz. */
function makeBeaconIcon(count: number) {
  const size = Math.min(26, 12 + Math.round(Math.sqrt(count) * 3))
  return L.divIcon({
    className: 'map-beacon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div class="map-beacon__body" style="--beacon-size:${size}px"><span class="map-beacon__ring"></span><span class="map-beacon__core"></span></div>`,
  })
}

/**
 * Alan seçimi: aktifken fareyle dikdörtgen çizilir, bırakınca harita
 * o alana yakınlaşır. Esc iptal eder. (Shift+sürükle her zaman çalışır.)
 */
function AreaSelector({
  active,
  onDone,
}: {
  active: boolean
  onDone: () => void
}) {
  const map = useMap()

  useEffect(() => {
    const container = map.getContainer()
    let shiftSelecting = false
    if (active) {
      map.dragging.disable()
      container.style.cursor = 'crosshair'
    }

    let start: L.LatLng | null = null
    let rect: L.Rectangle | null = null

    const toLatLng = (e: PointerEvent) =>
      map.mouseEventToLatLng(e as unknown as MouseEvent)

    const clearRect = () => {
      if (rect) map.removeLayer(rect)
      rect = null
      start = null
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (!active && !e.shiftKey)) return
      e.preventDefault()
      // Leaflet'in sürükleme dinleyicisi devreye girmeden olayı yakala.
      e.stopPropagation()
      if (!active && e.shiftKey) {
        shiftSelecting = true
        map.dragging.disable()
        container.style.cursor = 'crosshair'
      }
      start = toLatLng(e)
      rect = L.rectangle(L.latLngBounds(start, start), {
        color: '#2ec4b6',
        weight: 1.5,
        dashArray: '6 4',
        fillColor: '#2ec4b6',
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(map)
    }

    const onMove = (e: PointerEvent) => {
      if (!start || !rect) return
      rect.setBounds(L.latLngBounds(start, toLatLng(e)))
    }

    const onUp = (e: PointerEvent) => {
      if (!start || !rect) return
      const bounds = L.latLngBounds(start, toLatLng(e))
      clearRect()
      // Çok küçük (yanlışlıkla tıklama) seçimleri yok say
      const p1 = map.latLngToContainerPoint(bounds.getNorthWest())
      const p2 = map.latLngToContainerPoint(bounds.getSouthEast())
      if (Math.abs(p1.x - p2.x) > 10 && Math.abs(p1.y - p2.y) > 10) {
        map.fitBounds(bounds, { animate: true })
      }
      if (shiftSelecting) {
        shiftSelecting = false
        map.dragging.enable()
        container.style.cursor = ''
      }
      if (active) onDone()
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearRect()
      if (shiftSelecting) {
        shiftSelecting = false
        map.dragging.enable()
        container.style.cursor = ''
      }
      if (active) onDone()
      }
    }

    // Capture fazı, Shift+sürükle davranışının Leaflet harita gezintisiyle
    // yarışmasını önler.
    container.addEventListener('pointerdown', onDown, true)
    container.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('keydown', onKey)

    return () => {
      container.removeEventListener('pointerdown', onDown, true)
      container.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('keydown', onKey)
      clearRect()
      map.dragging.enable()
      container.style.cursor = ''
    }
  }, [active, map, onDone])

  return null
}

/** Panel açılıp kapanınca harita kabı daralır; Leaflet'i yeniden boyutlandır. */
function ResizeHandler() {
  const map = useMap()

  useEffect(() => {
    const container = map.getContainer()
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [map])

  return null
}

/** İlk açılışta dünya görünümü (zoom 2); medyaya otomatik zoom yok. */
function InitialView() {
  const map = useMap()

  useEffect(() => {
    map.setView([20, 0], 2, { animate: false })
  }, [map])

  return null
}

function BoundsReporter({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: MapBounds) => void
}) {
  const map = useMapEvents({
    moveend: () => report(map),
    zoomend: () => report(map),
    resize: () => report(map),
  })

  const report = (m: L.Map) => {
    const b = m.getBounds()
    onBoundsChange({
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest(),
    })
  }

  useEffect(() => {
    report(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  return null
}

/** Kor/alev tarzı yoğunluk katmanı: çok medya = parlak alev rengi. */
function HeatLayer({ clusters }: { clusters: LocationCluster[] }) {
  const map = useMap()

  useEffect(() => {
    const points = clusters.flatMap((c) =>
      c.items.map(
        (i) => [i.latitude, i.longitude, 1] as [number, number, number],
      ),
    )
    if (points.length === 0) return

    const layer = L.heatLayer(points, {
      radius: 18,
      blur: 12,
      maxZoom: 14,
      minOpacity: 0.65,
      gradient: {
        0.15: '#5a1005',
        0.35: '#a82810',
        0.55: '#e8501a',
        0.75: '#ff8c1a',
        0.9: '#ffc233',
        1: '#fff3a0',
      },
    })
    layer.addTo(map)
    return () => {
      map.removeLayer(layer)
    }
  }, [clusters, map])

  return null
}

/** Uzaktayken sadece alev görünür; yakınlaşınca tıklanabilir noktalar çıkar. */
const MARKER_MIN_ZOOM = 11

function ZoomTracker({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMapEvents({
    zoomend: () => onZoom(map.getZoom()),
  })

  useEffect(() => {
    onZoom(map.getZoom())
  }, [map, onZoom])

  return null
}

/** Uzak görünümde her konumu belirgin kılan işaretler (alevin üstünde). */
function BeaconMarkers({ clusters }: { clusters: LocationCluster[] }) {
  const map = useMap()

  const icons = useMemo(() => {
    const m = new Map<string, L.DivIcon>()
    for (const c of clusters) m.set(c.id, makeBeaconIcon(c.items.length))
    return m
  }, [clusters])

  return (
    <>
      {clusters.map((cluster) => {
        const kinds = [...new Set(cluster.items.map((i) => KIND_LABEL[i.kind]))]
        return (
          <Marker
            key={cluster.id}
            position={[cluster.latitude, cluster.longitude]}
            icon={icons.get(cluster.id)}
            eventHandlers={{
              click: () =>
                map.setView(
                  [cluster.latitude, cluster.longitude],
                  Math.max(map.getZoom() + 4, MARKER_MIN_ZOOM),
                  { animate: true },
                ),
            }}
          >
            <Tooltip direction="top" offset={[0, -10]} opacity={0.95}>
              {cluster.items.length} medya · {kinds.join(' · ')}
            </Tooltip>
          </Marker>
        )
      })}
    </>
  )
}

function ClusterMarkers({ clusters }: { clusters: LocationCluster[] }) {
  const map = useMap()

  const icons = useMemo(() => {
    const m = new Map<string, L.DivIcon>()
    for (const c of clusters) m.set(c.id, makeDotIcon(c.items.length))
    return m
  }, [clusters])

  return (
    <>
      {clusters.map((cluster) => {
        const kinds = [...new Set(cluster.items.map((i) => KIND_LABEL[i.kind]))]
        return (
          <Marker
            key={cluster.id}
            position={[cluster.latitude, cluster.longitude]}
            icon={icons.get(cluster.id)}
            eventHandlers={{
              click: () =>
                map.setView(
                  [cluster.latitude, cluster.longitude],
                  Math.max(map.getZoom() + 2, 14),
                  { animate: true },
                ),
            }}
          >
            <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
              {cluster.items.length} medya · {kinds.join(' · ')}
            </Tooltip>
          </Marker>
        )
      })}
    </>
  )
}

interface WorldMapProps {
  clusters: LocationCluster[]
  onBoundsChange: (bounds: MapBounds) => void
}

export function WorldMap({ clusters, onBoundsChange }: WorldMapProps) {
  const [zoom, setZoom] = useState(2)
  const [selecting, setSelecting] = useState(false)
  const stopSelecting = useCallback(() => setSelecting(false), [])

  return (
    <>
    <MapContainer
      className="world-map"
      center={[20, 0]}
      zoom={2}
      minZoom={2}
      maxZoom={19}
      worldCopyJump
      zoomControl
      scrollWheelZoom
      doubleClickZoom
    >
      <TileLayer
        attribution='Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics'
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxZoom={19}
      />
      <TileLayer
        attribution=""
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
        maxZoom={19}
        opacity={0.85}
      />
      <ResizeHandler />
      <InitialView />
      <BoundsReporter onBoundsChange={onBoundsChange} />
      <ZoomTracker onZoom={setZoom} />
      <HeatLayer clusters={clusters} />
      {zoom >= MARKER_MIN_ZOOM ? (
        <ClusterMarkers clusters={clusters} />
      ) : (
        <BeaconMarkers clusters={clusters} />
      )}
      <AreaSelector active={selecting} onDone={stopSelecting} />
    </MapContainer>
    <button
      type="button"
      hidden
      className={`map-select-btn ${selecting ? 'is-active' : ''}`}
      onClick={() => setSelecting((v) => !v)}
      title="Haritada bir alan çiz, o alana yakınlaş (Esc iptal)"
    >
      <span aria-hidden>⬚</span> {selecting ? 'Alan çiz…' : 'Alan seç'}
    </button>
    <div className="map-area-hint" title="Shift basılıyken sol fare tuşuyla sürükleyip bırak">
      <kbd>Shift</kbd> + sürükle: alan seç
    </div>
    </>
  )
}
