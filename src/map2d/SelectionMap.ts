import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { BBox, SelectionShape, TexturePatch } from '../geo/bbox'
import { normalizeBBox } from '../geo/bbox'

export type SelectionMapCallbacks = {
  onMainBBoxChange: (bbox: BBox | null) => void
  onPatchesChange: (patches: TexturePatch[]) => void
  onMapZoomChange?: (zoom: number, centerLat: number) => void
  onSelectionChange?: () => void
}

type DrawMode = 'main' | 'patch' | 'none'

type HandleId =
  | 'nw'
  | 'ne'
  | 'sw'
  | 'se'
  | 'n'
  | 's'
  | 'w'
  | 'e'
  | 'move'
  | 'radius'

type EditTarget =
  | { kind: 'main' }
  | { kind: 'patch'; id: string }

const MIN_SPAN = 0.0005
const MIN_RADIUS_M = 20

export class SelectionMap {
  private map: L.Map
  private baseLayers: Record<string, L.TileLayer>
  private mainLayer: L.Rectangle | L.Circle | null = null
  private mainShape: SelectionShape = 'rect'
  private handles = new Map<HandleId, L.Marker>()
  private patchLayers = new Map<string, L.Rectangle | L.Circle>()
  private patchDeleteBtns = new Map<string, L.Marker>()
  private patches: TexturePatch[] = []
  private selectedPatchId: string | null = null
  private drawMode: DrawMode = 'main'
  private shape: SelectionShape = 'rect'
  private drawing = false
  private startLatLng: L.LatLng | null = null
  private tempLayer: L.Layer | null = null
  private patchZoom = 16
  private callbacks: SelectionMapCallbacks
  private editing: {
    target: EditTarget
    handle: HandleId
    originBounds: L.LatLngBounds
    originRadius?: number
    originCenter?: L.LatLng
    start: L.LatLng
  } | null = null

  constructor(container: HTMLElement, callbacks: SelectionMapCallbacks) {
    this.callbacks = callbacks

    this.baseLayers = {
      esri: L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 18,
          maxNativeZoom: 17,
          attribution: '© Esri',
        },
      ),
      osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        maxNativeZoom: 18,
        attribution: '© OpenStreetMap',
      }),
    }

    this.map = L.map(container, {
      center: [30.5, 114.3],
      zoom: 10,
      maxZoom: 18,
      layers: [this.baseLayers.esri!],
      zoomControl: false,
    })

    L.control
      .layers(
        {
          卫星影像: this.baseLayers.esri!,
          街道图: this.baseLayers.osm!,
        },
        {},
        { position: 'topright' },
      )
      .addTo(this.map)

    this.map.on('mousedown', this.onMouseDown)
    this.map.on('mousemove', this.onMapMouseMove)
    this.map.on('mouseup', this.onMouseUp)
    this.map.on('zoom zoomend moveend', this.onViewChanged)
    document.addEventListener('mousemove', this.onDocMouseMove)
    document.addEventListener('mouseup', this.onDocMouseUp)

    queueMicrotask(() => this.emitMapZoom())
  }

  getZoom(): number {
    return this.map.getZoom()
  }

  getCenterLat(): number {
    return this.map.getCenter().lat
  }

  getMapCenter(): { lat: number; lng: number } {
    const c = this.map.getCenter()
    return { lat: c.lat, lng: c.lng }
  }

  private emitMapZoom(): void {
    this.callbacks.onMapZoomChange?.(this.map.getZoom(), this.map.getCenter().lat)
  }

  setDrawMode(mode: DrawMode): void {
    const prev = this.drawMode
    const prevSelected = this.selectedPatchId
    this.drawMode = mode
    if (!this.editing) this.map.dragging.enable()
    if (mode === 'main') {
      this.selectedPatchId = null
      this.syncPatchStyles()
    }
    this.syncHandles()
    if (prev !== mode || prevSelected !== this.selectedPatchId) {
      this.callbacks.onSelectionChange?.()
    }
  }

  setShape(shape: SelectionShape): void {
    this.shape = shape
  }

  setPatchZoom(z: number): void {
    this.patchZoom = z
    for (const patch of this.patches) {
      patch.textureZoom = z
    }
  }

  getMainBBox(): BBox | null {
    if (!this.mainLayer) return null
    return boundsToBBox(this.mainLayer.getBounds())
  }

  getMainShape(): SelectionShape {
    return this.mainShape
  }

  getPatches(): TexturePatch[] {
    return [...this.patches]
  }

  getSelectedPatch(): TexturePatch | null {
    if (!this.selectedPatchId) return null
    return this.patches.find((p) => p.id === this.selectedPatchId) ?? null
  }

  setPatchBBox(id: string, bbox: BBox, shape?: SelectionShape): void {
    const patch = this.patches.find((p) => p.id === id)
    if (!patch) return
    patch.bbox = normalizeBBox(bbox)
    if (shape) patch.shape = shape
    const layer = this.patchLayers.get(id)
    if (layer) this.map.removeLayer(layer)
    this.patchLayers.delete(id)
    this.addPatchLayer(patch)
    this.selectPatch(id)
    this.callbacks.onPatchesChange([...this.patches])
  }

  createPatchAt(bbox: BBox, shape: SelectionShape): TexturePatch {
    this.createPatch(bbox, shape)
    return this.patches[this.patches.length - 1]!
  }

  setView(lat: number, lng: number, zoom = 12): void {
    this.map.setView([lat, lng], zoom)
  }

  fitBBox(bbox: BBox): void {
    const b = normalizeBBox(bbox)
    this.map.fitBounds([
      [b.south, b.west],
      [b.north, b.east],
    ])
  }

  setMainBBox(bbox: BBox, shape: SelectionShape = this.shape): void {
    const b = normalizeBBox(bbox)
    this.mainShape = shape
    this.replaceMainLayer(b, shape)
    this.selectedPatchId = null
    this.syncPatchStyles()
    this.syncHandles()
    this.callbacks.onMainBBoxChange(b)
  }

  clearPatches(): void {
    for (const id of [...this.patchLayers.keys()]) this.removePatch(id, false)
    this.patches = []
    this.selectedPatchId = null
    this.syncHandles()
    this.callbacks.onPatchesChange([])
  }

  removeLastPatch(): void {
    const last = this.patches[this.patches.length - 1]
    if (!last) return
    this.removePatch(last.id)
  }

  removePatch(id: string, emit = true): void {
    const idx = this.patches.findIndex((p) => p.id === id)
    if (idx >= 0) this.patches.splice(idx, 1)
    const layer = this.patchLayers.get(id)
    if (layer) this.map.removeLayer(layer)
    this.patchLayers.delete(id)
    const btn = this.patchDeleteBtns.get(id)
    if (btn) this.map.removeLayer(btn)
    this.patchDeleteBtns.delete(id)
    if (this.selectedPatchId === id) this.selectedPatchId = null
    this.syncHandles()
    if (emit) this.callbacks.onPatchesChange([...this.patches])
  }

  private replaceMainLayer(bbox: BBox, shape: SelectionShape): void {
    if (this.mainLayer) {
      this.map.removeLayer(this.mainLayer)
      this.mainLayer = null
    }
    if (shape === 'circle') {
      const center = L.latLng(
        (bbox.south + bbox.north) / 2,
        (bbox.west + bbox.east) / 2,
      )
      const edge = L.latLng((bbox.south + bbox.north) / 2, bbox.east)
      const radius = Math.max(MIN_RADIUS_M, this.map.distance(center, edge))
      this.mainLayer = L.circle(center, {
        ...pathStyle('main'),
        radius,
      }).addTo(this.map)
    } else {
      this.mainLayer = L.rectangle(
        [
          [bbox.south, bbox.west],
          [bbox.north, bbox.east],
        ],
        pathStyle('main'),
      ).addTo(this.map)
    }
    this.bindMainEvents(this.mainLayer)
  }

  private bindMainEvents(layer: L.Rectangle | L.Circle): void {
    layer.on('mousedown', (e: L.LeafletMouseEvent) => {
      if (e.originalEvent.shiftKey) return
      if (this.drawMode === 'patch') return
      L.DomEvent.stopPropagation(e)
      this.selectedPatchId = null
      this.syncPatchStyles()
      this.beginEdit({ kind: 'main' }, 'move', e.latlng)
    })
  }

  private addPatchLayer(patch: TexturePatch): void {
    const b = normalizeBBox(patch.bbox)
    const shape = patch.shape ?? 'rect'
    let layer: L.Rectangle | L.Circle
    if (shape === 'circle') {
      const center = L.latLng((b.south + b.north) / 2, (b.west + b.east) / 2)
      const edge = L.latLng((b.south + b.north) / 2, b.east)
      const radius = Math.max(MIN_RADIUS_M, this.map.distance(center, edge))
      layer = L.circle(center, {
        ...pathStyle('patch'),
        radius,
      }).addTo(this.map)
    } else {
      layer = L.rectangle(
        [
          [b.south, b.west],
          [b.north, b.east],
        ],
        pathStyle('patch'),
      ).addTo(this.map)
    }
    layer.on('mousedown', (e: L.LeafletMouseEvent) => {
      if (e.originalEvent.shiftKey) return
      L.DomEvent.stopPropagation(e)
      this.selectPatch(patch.id)
      if (this.drawMode === 'patch' || this.drawMode === 'main') {
        this.beginEdit({ kind: 'patch', id: patch.id }, 'move', e.latlng)
      }
    })
    this.patchLayers.set(patch.id, layer)
    this.ensurePatchDeleteBtn(patch.id)
    this.syncPatchDeleteBtns()
  }

  private ensurePatchDeleteBtn(id: string): void {
    if (this.patchDeleteBtns.has(id)) return
    const marker = L.marker([0, 0], {
      interactive: true,
      keyboard: false,
      zIndexOffset: 3000,
      icon: L.divIcon({
        className: 'patch-delete-wrap',
        iconSize: [22, 22],
        iconAnchor: [-2, 24],
        html: `<button type="button" class="patch-delete-btn" title="删除此局部选区" aria-label="删除">×</button>`,
      }),
    }).addTo(this.map)

    marker.on('click', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e.originalEvent)
      L.DomEvent.preventDefault(e.originalEvent)
      this.removePatch(id)
    })
    marker.on('mousedown', (e: L.LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(e.originalEvent)
      L.DomEvent.preventDefault(e.originalEvent)
    })

    // 点击图标内按钮
    const el = marker.getElement()
    el?.querySelector('.patch-delete-btn')?.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      this.removePatch(id)
    })

    this.patchDeleteBtns.set(id, marker)
  }

  private syncPatchDeleteBtns(): void {
    for (const [id, marker] of this.patchDeleteBtns) {
      const layer = this.patchLayers.get(id)
      if (!layer) {
        this.map.removeLayer(marker)
        this.patchDeleteBtns.delete(id)
        continue
      }
      const b = layer.getBounds()
      marker.setLatLng([b.getNorth(), b.getEast()])
      const el = marker.getElement()
      if (el) {
        el.style.display = ''
        el.classList.toggle('is-selected', id === this.selectedPatchId)
      }
    }
  }

  private selectPatch(id: string): void {
    this.selectedPatchId = id
    this.syncPatchStyles()
    this.syncPatchDeleteBtns()
    this.syncHandles()
    this.callbacks.onSelectionChange?.()
  }

  private syncPatchStyles(): void {
    for (const [id, layer] of this.patchLayers) {
      const selected = id === this.selectedPatchId
      layer.setStyle({
        ...pathStyle('patch'),
        weight: selected ? 4 : 3,
        fillOpacity: selected ? 0.28 : 0.18,
      })
    }
  }

  private onViewChanged = (): void => {
    this.syncHandles()
    this.syncPatchDeleteBtns()
    this.emitMapZoom()
  }

  private ensureHandles(): void {
    if (this.handles.size > 0) return
    const ids: HandleId[] = ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e', 'radius']
    for (const id of ids) {
      const marker = L.marker([0, 0], {
        draggable: false,
        interactive: true,
        keyboard: false,
        zIndexOffset: 2500,
        riseOnHover: true,
        icon: L.divIcon({
          className: `sel-handle-wrap sel-handle-${id}`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
          html: `<span class="sel-handle-dot" aria-hidden="true"></span>`,
        }),
      }).addTo(this.map)

      marker.on('mousedown', (e: L.LeafletMouseEvent) => {
        if (e.originalEvent.shiftKey) return
        L.DomEvent.stopPropagation(e.originalEvent)
        L.DomEvent.preventDefault(e.originalEvent)
        const target = this.currentEditTarget()
        if (!target) return
        this.beginEdit(target, id, e.latlng)
      })

      this.handles.set(id, marker)
    }
  }

  private currentEditTarget(): EditTarget | null {
    if (this.drawMode === 'patch' && this.selectedPatchId) {
      return { kind: 'patch', id: this.selectedPatchId }
    }
    if (this.mainLayer) return { kind: 'main' }
    return null
  }

  private syncHandles(): void {
    const target = this.currentEditTarget()
    if (!target) {
      this.setHandlesVisible([])
      return
    }

    this.ensureHandles()
    const layer =
      target.kind === 'main'
        ? this.mainLayer
        : this.patchLayers.get(target.id)
    if (!layer) {
      this.setHandlesVisible([])
      return
    }

    const isCircle = layer instanceof L.Circle
    const isPatch = target.kind === 'patch'
    const dots = this.containerHandleDots()
    dots.forEach((el) => el.classList.toggle('patch', isPatch))

    if (isCircle) {
      const center = layer.getLatLng()
      const radius = layer.getRadius()
      const east = this.destination(center, 90, radius)
      this.handles.get('radius')?.setLatLng(east)
      this.setHandlesVisible(['radius'])
    } else {
      const b = layer.getBounds()
      const n = b.getNorth()
      const s = b.getSouth()
      const w = b.getWest()
      const e = b.getEast()
      const positions: Record<Exclude<HandleId, 'move' | 'radius'>, L.LatLngExpression> = {
        nw: [n, w],
        ne: [n, e],
        sw: [s, w],
        se: [s, e],
        n: [n, (w + e) / 2],
        s: [s, (w + e) / 2],
        w: [(n + s) / 2, w],
        e: [(n + s) / 2, e],
      }
      for (const [id, latlng] of Object.entries(positions)) {
        this.handles.get(id as HandleId)?.setLatLng(latlng)
      }
      this.setHandlesVisible(['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'])
    }
  }

  private containerHandleDots(): HTMLElement[] {
    return Array.from(
      this.map.getContainer().querySelectorAll('.sel-handle-dot'),
    ) as HTMLElement[]
  }

  private setHandlesVisible(ids: HandleId[]): void {
    const allow = new Set(ids)
    for (const [id, marker] of this.handles) {
      const el = marker.getElement()
      if (el) el.style.display = allow.has(id) ? '' : 'none'
    }
  }

  private clearHandles(): void {
    for (const marker of this.handles.values()) this.map.removeLayer(marker)
    this.handles.clear()
  }

  private beginEdit(target: EditTarget, handle: HandleId, start: L.LatLng): void {
    const layer =
      target.kind === 'main'
        ? this.mainLayer
        : this.patchLayers.get(target.id)
    if (!layer) return

    this.editing = {
      target,
      handle,
      originBounds: layer.getBounds(),
      originRadius: layer instanceof L.Circle ? layer.getRadius() : undefined,
      originCenter: layer instanceof L.Circle ? layer.getLatLng() : undefined,
      start,
    }
    this.map.dragging.disable()
    this.map.getContainer().classList.add('editing-selection')
  }

  private onDocMouseMove = (ev: MouseEvent): void => {
    if (!this.editing) return
    this.onEditMove(this.map.mouseEventToLatLng(ev))
  }

  private onDocMouseUp = (): void => {
    if (this.editing) this.endEdit()
  }

  private onEditMove(latlng: L.LatLng): void {
    if (!this.editing) return
    const { target, handle, originBounds, originRadius, originCenter, start } =
      this.editing
    const layer =
      target.kind === 'main'
        ? this.mainLayer
        : this.patchLayers.get(target.id)
    if (!layer) return

    if (layer instanceof L.Circle) {
      if (handle === 'move') {
        const dLat = latlng.lat - start.lat
        const dLng = latlng.lng - start.lng
        const c = originCenter!
        layer.setLatLng([c.lat + dLat, c.lng + dLng])
      } else {
        const center = originCenter ?? layer.getLatLng()
        const radius = Math.max(MIN_RADIUS_M, this.map.distance(center, latlng))
        layer.setLatLng(center)
        layer.setRadius(radius)
        void originRadius
      }
    } else {
      let west = originBounds.getWest()
      let east = originBounds.getEast()
      let south = originBounds.getSouth()
      let north = originBounds.getNorth()

      if (handle === 'move') {
        const dLat = latlng.lat - start.lat
        const dLng = latlng.lng - start.lng
        west += dLng
        east += dLng
        south += dLat
        north += dLat
      } else {
        if (handle.includes('n')) north = latlng.lat
        if (handle.includes('s')) south = latlng.lat
        if (handle.includes('w')) west = latlng.lng
        if (handle.includes('e')) east = latlng.lng
        if (east - west < MIN_SPAN) {
          if (handle.includes('w')) west = east - MIN_SPAN
          else east = west + MIN_SPAN
        }
        if (north - south < MIN_SPAN) {
          if (handle.includes('s')) south = north - MIN_SPAN
          else north = south + MIN_SPAN
        }
      }

      layer.setBounds(
        L.latLngBounds(
          [Math.min(south, north), Math.min(west, east)],
          [Math.max(south, north), Math.max(west, east)],
        ),
      )
    }

    this.syncHandles()
    this.syncPatchDeleteBtns()
  }

  private endEdit(): void {
    if (!this.editing) return
    const { target } = this.editing
    this.editing = null
    this.map.dragging.enable()
    this.map.getContainer().classList.remove('editing-selection')

    if (target.kind === 'main' && this.mainLayer) {
      this.callbacks.onMainBBoxChange(boundsToBBox(this.mainLayer.getBounds()))
    } else if (target.kind === 'patch') {
      const layer = this.patchLayers.get(target.id)
      const patch = this.patches.find((p) => p.id === target.id)
      if (layer && patch) {
        patch.bbox = boundsToBBox(layer.getBounds())
        this.callbacks.onPatchesChange([...this.patches])
      }
    }
    this.syncHandles()
    this.syncPatchDeleteBtns()
  }

  private onMouseDown = (e: L.LeafletMouseEvent): void => {
    if (this.editing) return
    if (this.drawMode === 'none') return
    if (!e.originalEvent.shiftKey) {
      // 单击空白取消黄框选中
      if (this.drawMode === 'patch' && this.selectedPatchId) {
        this.selectedPatchId = null
        this.syncPatchStyles()
        this.syncHandles()
      }
      return
    }
    this.drawing = true
    this.startLatLng = e.latlng
    this.map.dragging.disable()
    if (this.tempLayer) {
      this.map.removeLayer(this.tempLayer)
      this.tempLayer = null
    }
  }

  private onMapMouseMove = (e: L.LeafletMouseEvent): void => {
    if (this.editing) {
      this.onEditMove(e.latlng)
      return
    }
    if (!this.drawing || !this.startLatLng) return

    if (this.shape === 'circle') {
      const radius = Math.max(
        MIN_RADIUS_M,
        this.map.distance(this.startLatLng, e.latlng),
      )
      if (this.tempLayer instanceof L.Circle) {
        this.tempLayer.setRadius(radius)
      } else {
        if (this.tempLayer) this.map.removeLayer(this.tempLayer)
        this.tempLayer = L.circle(this.startLatLng, {
          ...pathStyle(this.drawMode === 'patch' ? 'patch' : 'main'),
          radius,
          dashArray: '6 4',
        }).addTo(this.map)
      }
      return
    }

    const bounds = L.latLngBounds(this.startLatLng, e.latlng)
    if (this.tempLayer instanceof L.Rectangle) {
      this.tempLayer.setBounds(bounds)
    } else {
      if (this.tempLayer) this.map.removeLayer(this.tempLayer)
      this.tempLayer = L.rectangle(bounds, {
        ...pathStyle(this.drawMode === 'patch' ? 'patch' : 'main'),
        dashArray: '6 4',
      }).addTo(this.map)
    }
  }

  private onMouseUp = (e: L.LeafletMouseEvent): void => {
    if (this.editing) {
      this.endEdit()
      return
    }
    if (!this.drawing || !this.startLatLng) return
    this.drawing = false
    this.map.dragging.enable()

    const start = this.startLatLng
    this.startLatLng = null
    if (this.tempLayer) {
      this.map.removeLayer(this.tempLayer)
      this.tempLayer = null
    }

    if (this.shape === 'circle') {
      const radius = this.map.distance(start, e.latlng)
      if (radius < MIN_RADIUS_M) return
      const bbox = circleToBBox(start, radius)
      if (this.drawMode === 'main') {
        this.setMainBBox(bbox, 'circle')
      } else if (this.drawMode === 'patch') {
        this.createPatch(bbox, 'circle')
      }
      return
    }

    const bounds = L.latLngBounds(start, e.latlng)
    if (
      bounds.getNorth() === bounds.getSouth() ||
      bounds.getEast() === bounds.getWest()
    ) {
      return
    }
    const bbox = boundsToBBox(bounds)
    if (this.drawMode === 'main') {
      this.setMainBBox(bbox, 'rect')
    } else if (this.drawMode === 'patch') {
      this.createPatch(bbox, 'rect')
    }
  }

  private createPatch(bbox: BBox, shape: SelectionShape): void {
    const id = `patch-${Date.now()}`
    const patch: TexturePatch = {
      id,
      bbox,
      textureZoom: this.patchZoom,
      shape,
    }
    this.patches.push(patch)
    this.addPatchLayer(patch)
    this.selectPatch(id)
    this.callbacks.onPatchesChange([...this.patches])
  }

  private destination(from: L.LatLng, bearingDeg: number, distanceM: number): L.LatLng {
    return destinationLatLng(from, bearingDeg, distanceM)
  }

  invalidateSize(): void {
    this.map.invalidateSize()
  }

  dispose(): void {
    this.map.off('mousedown', this.onMouseDown)
    this.map.off('mousemove', this.onMapMouseMove)
    this.map.off('mouseup', this.onMouseUp)
    this.map.off('zoom zoomend moveend', this.onViewChanged)
    document.removeEventListener('mousemove', this.onDocMouseMove)
    document.removeEventListener('mouseup', this.onDocMouseUp)
    this.clearHandles()
    this.map.remove()
  }
}

function boundsToBBox(bounds: L.LatLngBounds): BBox {
  return normalizeBBox({
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
  })
}

/** Leaflet Circle.getBounds() 需要图层已挂到地图；此处用测地线四点直接算包围盒。 */
function circleToBBox(center: L.LatLng, radiusM: number): BBox {
  const north = destinationLatLng(center, 0, radiusM)
  const east = destinationLatLng(center, 90, radiusM)
  const south = destinationLatLng(center, 180, radiusM)
  const west = destinationLatLng(center, 270, radiusM)
  return normalizeBBox({
    west: west.lng,
    south: south.lat,
    east: east.lng,
    north: north.lat,
  })
}

function destinationLatLng(
  from: L.LatLng,
  bearingDeg: number,
  distanceM: number,
): L.LatLng {
  const R = 6378137
  const δ = distanceM / R
  const θ = (bearingDeg * Math.PI) / 180
  const φ1 = (from.lat * Math.PI) / 180
  const λ1 = (from.lng * Math.PI) / 180
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  )
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    )
  return L.latLng((φ2 * 180) / Math.PI, (λ2 * 180) / Math.PI)
}

function pathStyle(kind: 'main' | 'patch'): L.PathOptions {
  if (kind === 'patch') {
    return {
      color: '#f59e0b',
      fillColor: '#fbbf24',
      weight: 3,
      opacity: 1,
      fillOpacity: 0.2,
      className: 'patch-selection-rect',
    }
  }
  return {
    color: '#38bdf8',
    fillColor: '#38bdf8',
    weight: 2,
    opacity: 1,
    fillOpacity: 0.12,
    className: 'main-selection-rect',
  }
}
