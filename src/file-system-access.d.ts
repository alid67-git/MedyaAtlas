interface DirectoryPickerOptions {
  id?: string
  mode?: 'read' | 'readwrite'
  startIn?: FileSystemHandle | string
}

interface Window {
  showDirectoryPicker: (
    options?: DirectoryPickerOptions,
  ) => Promise<FileSystemDirectoryHandle>
}

declare module 'mp4box' {
  const MP4Box: unknown
  export default MP4Box
}

declare module 'leaflet.heat' {
  // Yan etkiyle L.heatLayer'ı kaydeder
}

declare namespace L {
  interface HeatLayerOptions {
    minOpacity?: number
    maxZoom?: number
    max?: number
    radius?: number
    blur?: number
    gradient?: Record<number, string>
  }

  interface HeatLayer extends Layer {
    setLatLngs(latlngs: Array<[number, number, number?]>): HeatLayer
    redraw(): HeatLayer
  }

  function heatLayer(
    latlngs: Array<[number, number, number?]>,
    options?: HeatLayerOptions,
  ): HeatLayer
}
