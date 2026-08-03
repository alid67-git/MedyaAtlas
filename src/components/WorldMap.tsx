import { useEffect, useMemo, useState } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  Tooltip,
  Polyline,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'
import type { LocationCluster, MediaItem } from '../types'
import { trackBounds, type MapTrack } from '../lib/tracks'
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
function BeaconMarkers({
  clusters,
  onClusterSelect,
}: {
  clusters: LocationCluster[]
  onClusterSelect?: (items: LocationCluster['items']) => void
}) {
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
              click: () => {
                onClusterSelect?.(cluster.items)
                map.setView(
                  [cluster.latitude, cluster.longitude],
                  Math.max(map.getZoom() + 4, MARKER_MIN_ZOOM),
                  { animate: true },
                )
              },
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

function ClusterMarkers({
  clusters,
  onClusterSelect,
}: {
  clusters: LocationCluster[]
  onClusterSelect?: (items: LocationCluster['items']) => void
}) {
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
              click: () => {
                onClusterSelect?.(cluster.items)
                map.setView(
                  [cluster.latitude, cluster.longitude],
                  Math.max(map.getZoom() + 2, 14),
                  { animate: true },
                )
              },
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

function makeFocusIcon() {
  return L.divIcon({
    className: 'map-focus',
    iconSize: [64, 64],
    iconAnchor: [32, 32],
    html: `<div class="map-focus__body"><span class="map-focus__ring"></span><span class="map-focus__cross"></span><span class="map-focus__core"></span></div>`,
  })
}

/** Galeriden seçilen medya — zoom yok; görünür alandaysa pan, belirgin işaret. */
function FocusTarget({
  point,
}: {
  point: { latitude: number; longitude: number; id: string } | null
}) {
  const map = useMap()
  const icon = useMemo(() => makeFocusIcon(), [])

  useEffect(() => {
    if (!point) return
    if (Math.abs(point.latitude) < 0.01 && Math.abs(point.longitude) < 0.01) return
    const latlng = L.latLng(point.latitude, point.longitude)
    if (!map.getBounds().pad(-0.15).contains(latlng)) {
      map.panTo(latlng, { animate: true })
    }
  }, [map, point?.id, point?.latitude, point?.longitude])

  if (!point) return null
  if (Math.abs(point.latitude) < 0.01 && Math.abs(point.longitude) < 0.01) return null

  return (
    <Marker
      position={[point.latitude, point.longitude]}
      icon={icon}
      zIndexOffset={1000}
    >
      <Tooltip direction="top" offset={[0, -28]} opacity={0.98} permanent>
        Seçili
      </Tooltip>
    </Marker>
  )
}

/** Tek çubuk: dünya (üstte) + +/- zoom. */
function WorldAndZoomControls() {
  const map = useMap()

  useEffect(() => {
    // Eski/çift zoom kontrollerini temizle (HMR / StrictMode artıkları)
    if (map.zoomControl) map.removeControl(map.zoomControl)
    const corner = containerTopLeft(map)
    corner
      ?.querySelectorAll('.leaflet-control-zoom, .map-world-control, .map-nav-control')
      .forEach((el) => el.remove())

    const nav = new L.Control({ position: 'topleft' })
    nav.onAdd = () => {
      const wrap = L.DomUtil.create('div', 'leaflet-bar map-nav-control')
      const world = L.DomUtil.create('a', 'map-world-btn', wrap)
      world.href = '#'
      world.title = 'Tüm dünya haritası'
      world.setAttribute('role', 'button')
      world.setAttribute('aria-label', 'Tüm dünya haritası')
      world.innerHTML =
        '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>'

      const zoomIn = L.DomUtil.create('a', 'map-zoom-btn', wrap)
      zoomIn.href = '#'
      zoomIn.title = 'Yakınlaştır'
      zoomIn.setAttribute('role', 'button')
      zoomIn.setAttribute('aria-label', 'Yakınlaştır')
      zoomIn.innerHTML = '+'

      const zoomOut = L.DomUtil.create('a', 'map-zoom-btn', wrap)
      zoomOut.href = '#'
      zoomOut.title = 'Uzaklaştır'
      zoomOut.setAttribute('role', 'button')
      zoomOut.setAttribute('aria-label', 'Uzaklaştır')
      zoomOut.innerHTML = '&#x2212;'

      L.DomEvent.disableClickPropagation(wrap)
      L.DomEvent.on(world, 'click', (event) => {
        L.DomEvent.preventDefault(event)
        map.setView([20, 0], 2, { animate: true })
      })
      L.DomEvent.on(zoomIn, 'click', (event) => {
        L.DomEvent.preventDefault(event)
        map.zoomIn()
      })
      L.DomEvent.on(zoomOut, 'click', (event) => {
        L.DomEvent.preventDefault(event)
        map.zoomOut()
      })
      return wrap
    }
    nav.addTo(map)
    return () => {
      nav.remove()
    }
  }, [map])

  return null
}

function containerTopLeft(map: L.Map): HTMLElement | null {
  const corners = (map as L.Map & { _controlCorners?: Record<string, HTMLElement> })
    ._controlCorners
  return corners?.topleft ?? null
}

interface WorldMapProps {
  clusters: LocationCluster[]
  tracks?: MapTrack[]
  selectedTrackId?: string | null
  onBoundsChange: (bounds: MapBounds) => void
  /** Pin tıklanınca o kümedeki medyalar (galeri senkronu). */
  onClusterSelect?: (items: MediaItem[]) => void
  /** Güzergah çizgisine tıklanınca. */
  onTrackSelect?: (track: MapTrack) => void
  /** Galeriden tek tıkla vurgulanan konum */
  focusPoint?: { id: string; latitude: number; longitude: number } | null
  /** Yer aramasından haritaya git */
  flyTo?: {
    id: string
    latitude: number
    longitude: number
    bbox?: [number, number, number, number]
  } | null
}

function FitSelectedTrack({ track }: { track: MapTrack | null }) {
  const map = useMap()
  useEffect(() => {
    if (!track) return
    const b = trackBounds(track)
    if (!b) return
    map.fitBounds(
      [
        [b.south, b.west],
        [b.north, b.east],
      ],
      { padding: [48, 48], maxZoom: 14, animate: true },
    )
  }, [map, track?.id])
  return null
}

function FlyToTarget({
  target,
}: {
  target: {
    id: string
    latitude: number
    longitude: number
    bbox?: [number, number, number, number]
  } | null
}) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    if (target.bbox) {
      const [south, north, west, east] = target.bbox
      map.fitBounds(
        [
          [south, west],
          [north, east],
        ],
        { padding: [40, 40], maxZoom: 12, animate: true },
      )
      return
    }
    map.setView([target.latitude, target.longitude], 11, { animate: true })
  }, [map, target?.id])
  return null
}

function TrackLayers({
  tracks,
  selectedTrackId,
  onTrackSelect,
}: {
  tracks: MapTrack[]
  selectedTrackId?: string | null
  onTrackSelect?: (track: MapTrack) => void
}) {
  // Yalnızca menüde işaretlenen (visible === true) güzergahlar
  const visible = tracks.filter((t) => t.visible === true)
  if (visible.length === 0) return null
  return (
    <>
      {visible.map((track) => {
        const selected = track.id === selectedTrackId
        return (
          <Polyline
            key={track.id}
            positions={track.points.map(
              (p) => [p.latitude, p.longitude] as [number, number],
            )}
            pathOptions={{
              color: selected ? '#ffd166' : '#2ec4b6',
              weight: selected ? 5 : 3,
              opacity: selected ? 1 : 0.85,
            }}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stopPropagation(e)
                onTrackSelect?.(track)
              },
            }}
          >
            <Tooltip sticky>
              <strong>{track.name}</strong>
              <br />
              {(track.pointCount ?? track.points.length).toLocaleString('tr-TR')} nokta
              {onTrackSelect ? (
                <>
                  <br />
                  <em>Tıkla: ride tarihlerindeki medya</em>
                </>
              ) : null}
            </Tooltip>
          </Polyline>
        )
      })}
    </>
  )
}

export function WorldMap({
  clusters,
  tracks = [],
  selectedTrackId = null,
  onBoundsChange,
  onClusterSelect,
  onTrackSelect,
  focusPoint = null,
  flyTo = null,
}: WorldMapProps) {
  const [zoom, setZoom] = useState(2)
  const selectedTrack =
    tracks.find((t) => t.id === selectedTrackId && t.visible === true) ?? null

  return (
    <>
    <MapContainer
      className="world-map"
      center={[20, 0]}
      zoom={2}
      minZoom={2}
      maxZoom={19}
      worldCopyJump
      zoomControl={false}
      scrollWheelZoom
      doubleClickZoom
      dragging
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
      <WorldAndZoomControls />
      <HeatLayer clusters={clusters} />
      <TrackLayers
        tracks={tracks}
        selectedTrackId={selectedTrackId}
        onTrackSelect={onTrackSelect}
      />
      <FitSelectedTrack track={selectedTrack} />
      <FlyToTarget target={flyTo} />
      {zoom >= MARKER_MIN_ZOOM ? (
        <ClusterMarkers clusters={clusters} onClusterSelect={onClusterSelect} />
      ) : (
        <BeaconMarkers clusters={clusters} onClusterSelect={onClusterSelect} />
      )}
      <FocusTarget point={focusPoint} />
    </MapContainer>
    <div className="map-area-hint" title="Sürükle: taşı · tekerlek: zoom · +/−/dünya: kontroller">
      Sürükle: taşı · tekerlek: zoom
    </div>
    </>
  )
}
