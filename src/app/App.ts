import type { Mesh } from 'three'
import type { BBox, TexturePatch } from '../geo/bbox'
import {
  bboxAreaKm2,
  bboxCenter,
  bboxFromAreaKm2,
  bboxFromCircleAreaKm2,
  bboxIntersect,
  scaleBBoxToAreaKm2,
} from '../geo/bbox'
import { describePrecision } from '../geo/precision'
import { fetchHeightGrid, resolveSampleSize, type HeightGrid } from '../geo/dem'
import { geocode } from '../geo/geocode'
import { getMapboxToken, getProvider, setMapboxToken } from '../geo/providers'
import { countTiles } from '../geo/tiles'
import { SelectionMap } from '../map2d/SelectionMap'
import {
  applyTexture,
  applyVerticalExaggeration,
  buildTerrainMesh,
  disposeTerrain,
} from '../terrain/TerrainBuilder'
import { SceneView } from '../terrain/SceneView'
import { buildTextureAtlas } from '../terrain/TextureAtlas'
import { downloadArrayBuffer, exportGLB, formatBytes } from '../export/exportGLTF'
import {
  exportObjZip,
  exportSTL,
  exportTexturePng,
} from '../export/exportZip'
import {
  mountPanel,
  renderSearchResults,
  type PanelValues,
} from '../ui/panel'

export class App {
  private map!: SelectionMap
  private view!: SceneView
  private panel!: ReturnType<typeof mountPanel>
  private mainBBox: BBox | null = null
  private patches: TexturePatch[] = []
  private heightGrid: HeightGrid | null = null
  private terrainMesh: Mesh | null = null
  private lastSearch: Awaited<ReturnType<typeof geocode>> = []
  private values: PanelValues
  private readonly root: HTMLElement

  constructor(root: HTMLElement) {
    this.root = root
    this.values = {
      searchMode: 'place',
      query: '',
      lat: '31.8206',
      lng: '117.2272',
      providerId: 'esri',
      demZoom: 12,
      textureZoom: 14,
      patchZoom: 16,
      verticalExaggeration: 1.5,
      maxEdge: 256,
      mapboxToken: getMapboxToken(),
      drawMode: 'main',
      shape: 'rect',
    }
  }

  start(): void {
    this.root.innerHTML = `
      <aside id="sidebar" class="sidebar"></aside>
      <main class="workspace is-map-main" id="workspace">
        <section class="map-pane is-main" id="map-pane">
          <div class="pane-title" id="map-pane-title">二维选区 · Shift+拖拽画框</div>
          <div id="map2d" class="map2d"></div>
          <div class="map-hud" id="map-hud">
            <div class="map-hud-primary" id="map-hud-primary">选区面积 —</div>
            <div class="map-hud-secondary" id="map-hud-secondary">Shift + 拖拽框选 · 拖锚点调整</div>
          </div>
        </section>
        <section class="view-pane is-pip" id="view-pane" title="点击放大三维预览">
          <button type="button" class="pip-toggle-btn" id="view-pip-toggle" title="收起三维预览" aria-label="收起三维预览">
            <span class="pip-toggle-icon" aria-hidden="true">›</span>
          </button>
          <div class="pane-title">三维预览</div>
          <div id="view3d" class="view3d"></div>
        </section>
      </main>
    `

    const sidebar = this.root.querySelector('#sidebar') as HTMLElement
    const mapEl = this.root.querySelector('#map2d') as HTMLElement
    const viewEl = this.root.querySelector('#view3d') as HTMLElement
    const workspace = this.root.querySelector('#workspace') as HTMLElement
    this.bindWorkspaceSwap(workspace)

    this.panel = mountPanel(sidebar, this.values, {
      onSearch: () => void this.handleSearch(),
      onGenerate: () => void this.handleGenerate(),
      onRebuildTexture: () => void this.handleRebuildTexture(),
      onExportGlb: () => void this.handleExportGlb(),
      onExportObj: () => void this.handleExportObj(),
      onExportStl: () => this.handleExportStl(),
      onExportTexture: () => void this.handleExportTexture(),
      onApplyArea: (areaKm2, mode) => this.handleApplyArea(areaKm2, mode),
      onChange: (v) => this.onPanelChange(v),
    })

    this.map = new SelectionMap(mapEl, {
      onMainBBoxChange: (bbox) => {
        this.mainBBox = bbox
        this.updateMeta()
      },
      onPatchesChange: (patches) => {
        this.patches = patches
        this.updateMeta()
      },
      onMapZoomChange: (zoom, centerLat) => {
        this.updateMapHud(zoom, centerLat)
      },
      onSelectionChange: () => this.updateMeta(true),
    })
    this.map.setDrawMode('main')
    this.map.setShape(this.values.shape)
    this.map.setPatchZoom(this.values.patchZoom)

    this.view = new SceneView(viewEl)

    // Default region near Huangshan for first-run friendliness
    this.map.setMainBBox({
      west: 118.05,
      south: 30.05,
      east: 118.25,
      north: 30.2,
    })
    this.map.fitBBox(this.mainBBox!)
    this.updateMeta()

    requestAnimationFrame(() => this.refreshPanes())
  }

  private bindWorkspaceSwap(workspace: HTMLElement): void {
    const mapPane = workspace.querySelector('#map-pane') as HTMLElement
    const viewPane = workspace.querySelector('#view-pane') as HTMLElement
    const toggleBtn = workspace.querySelector(
      '#view-pip-toggle',
    ) as HTMLButtonElement

    const syncToggleBtn = () => {
      const collapsed = viewPane.classList.contains('is-collapsed')
      const isPip = viewPane.classList.contains('is-pip')
      toggleBtn.hidden = !isPip && !collapsed
      toggleBtn.title = collapsed ? '展开三维预览' : '收起三维预览'
      toggleBtn.setAttribute(
        'aria-label',
        collapsed ? '展开三维预览' : '收起三维预览',
      )
      toggleBtn.classList.toggle('is-collapsed', collapsed)
    }

    const setCollapsed = (collapsed: boolean) => {
      viewPane.classList.toggle('is-collapsed', collapsed)
      workspace.classList.toggle('is-view-collapsed', collapsed)
      if (collapsed) {
        // 收起时确保回到地图为主 + 小窗模式
        setMain('map', false)
      }
      syncToggleBtn()
      this.refreshPanes()
    }

    const setMain = (main: 'map' | 'view', expandIfNeeded = true) => {
      if (expandIfNeeded && viewPane.classList.contains('is-collapsed')) {
        viewPane.classList.remove('is-collapsed')
        workspace.classList.remove('is-view-collapsed')
      }
      const mapIsMain = main === 'map'
      workspace.classList.toggle('is-map-main', mapIsMain)
      workspace.classList.toggle('is-view-main', !mapIsMain)
      mapPane.classList.toggle('is-main', mapIsMain)
      mapPane.classList.toggle('is-pip', !mapIsMain)
      viewPane.classList.toggle('is-main', !mapIsMain)
      viewPane.classList.toggle('is-pip', mapIsMain)
      mapPane.title = mapIsMain ? '' : '点击放大地图'
      viewPane.title = mapIsMain ? '点击放大三维预览' : ''
      const viewTitle = viewPane.querySelector('.pane-title')
      if (viewTitle) viewTitle.textContent = '三维预览'
      syncToggleBtn()
      this.refreshPanes()
    }

    toggleBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      const collapsed = viewPane.classList.contains('is-collapsed')
      setCollapsed(!collapsed)
    })

    const bindPipClick = (pane: HTMLElement, swapTo: 'map' | 'view') => {
      let downX = 0
      let downY = 0
      pane.addEventListener('pointerdown', (ev) => {
        if (!pane.classList.contains('is-pip')) return
        if (pane.classList.contains('is-collapsed')) return
        downX = ev.clientX
        downY = ev.clientY
      })
      pane.addEventListener('pointerup', (ev) => {
        if (!pane.classList.contains('is-pip')) return
        if (pane.classList.contains('is-collapsed')) return
        const t = ev.target as HTMLElement
        if (t.closest('.view3d-toolbar')) return
        if (t.closest('.patch-delete-btn')) return
        if (t.closest('.pip-toggle-btn')) return
        const dx = Math.abs(ev.clientX - downX)
        const dy = Math.abs(ev.clientY - downY)
        if (dx > 6 || dy > 6) return
        setMain(swapTo)
      })
    }

    bindPipClick(viewPane, 'view')
    bindPipClick(mapPane, 'map')
    syncToggleBtn()
  }

  private refreshPanes(): void {
    requestAnimationFrame(() => {
      this.map.invalidateSize()
      this.view.resize()
    })
  }

  private onPanelChange(v: PanelValues): void {
    const modeChanged = v.drawMode !== this.values.drawMode
    const shapeChanged = v.shape !== this.values.shape
    this.values = v
    setMapboxToken(v.mapboxToken)
    this.map.setDrawMode(v.drawMode)
    this.map.setShape(v.shape)
    this.map.setPatchZoom(v.patchZoom)
    this.panel.setModeHelp(v.drawMode)

    // 切换矩形/圆形时，立即把当前主选区改成对应形状
    if (shapeChanged) {
      const bbox = this.mainBBox ?? this.map.getMainBBox()
      if (bbox) {
        this.map.setMainBBox(bbox, v.shape)
        this.mainBBox = this.map.getMainBBox()
        this.panel.setStatus(
          v.shape === 'circle'
            ? '已切换为圆形选区，可拖边缘改半径'
            : '已切换为矩形选区，可拖锚点调整',
        )
      } else {
        this.panel.setStatus(
          v.shape === 'circle'
            ? '已选择圆形，按住 Shift 拖拽画出圆形选区'
            : '已选择矩形，按住 Shift 拖拽画出矩形选区',
        )
      }
    }

    this.updateMapHud()

    if (modeChanged && !shapeChanged) {
      if (v.drawMode === 'patch') {
        this.panel.setStatus('局部精度：Shift 新增多块，单击后可拖动调整')
      } else if (v.drawMode === 'main') {
        this.panel.setStatus('主区域：Shift 框选，拖锚点调整')
      } else {
        this.panel.setStatus('仅浏览地图')
      }
    }

    if (this.terrainMesh && this.heightGrid) {
      applyVerticalExaggeration(
        this.terrainMesh,
        this.heightGrid,
        v.verticalExaggeration,
      )
    }
    this.updateMeta(modeChanged)
  }

  private computeTargetBBox(
    current: BBox | null,
    areaKm2: number,
    mode: 'keep-ratio' | 'square',
    preferCircle: boolean,
    fallbackCenter: { lat: number; lng: number },
    keepShape: 'rect' | 'circle',
  ): { next: BBox; shape: 'rect' | 'circle' } {
    if (!current) {
      return {
        next: preferCircle
          ? bboxFromCircleAreaKm2(fallbackCenter, areaKm2)
          : bboxFromAreaKm2(fallbackCenter, areaKm2),
        shape: preferCircle ? 'circle' : 'rect',
      }
    }
    if (preferCircle || mode === 'square') {
      return {
        next: preferCircle
          ? bboxFromCircleAreaKm2(bboxCenter(current), areaKm2)
          : bboxFromAreaKm2(bboxCenter(current), areaKm2),
        shape: preferCircle ? 'circle' : 'rect',
      }
    }
    return {
      next: scaleBBoxToAreaKm2(current, areaKm2),
      shape: keepShape,
    }
  }

  private handleApplyArea(
    areaKm2: number,
    mode: 'keep-ratio' | 'square',
  ): void {
    if (this.values.drawMode === 'none') {
      this.panel.setStatus('请先切换到「主区域」或「局部精度」再设定面积')
      return
    }

    const modeLabel = mode === 'square'
      ? this.values.shape === 'circle'
        ? '正圆'
        : '正方形'
      : '保持比例'

    if (this.values.drawMode === 'patch') {
      const selected = this.map.getSelectedPatch()
      const preferCircle =
        this.values.shape === 'circle' || selected?.shape === 'circle'
      const center = selected
        ? bboxCenter(selected.bbox)
        : this.mainBBox
          ? bboxCenter(this.mainBBox)
          : this.map.getMapCenter()
      const { next, shape } = this.computeTargetBBox(
        selected?.bbox ?? null,
        areaKm2,
        mode,
        preferCircle,
        center,
        selected?.shape ?? (preferCircle ? 'circle' : 'rect'),
      )
      if (selected) {
        this.map.setPatchBBox(selected.id, next, shape)
      } else {
        this.map.createPatchAt(next, shape)
      }
      this.patches = this.map.getPatches()
      this.map.fitBBox(next)
      const shown = this.formatArea(bboxAreaKm2(next))
      this.panel.setStatus(
        `已将局部精度区设为约 ${shown} km²（${modeLabel}）`,
      )
      this.panel.setCurrentArea(bboxAreaKm2(next), true)
      this.updateMeta()
      return
    }

    const current = this.mainBBox ?? this.map.getMainBBox()
    const preferCircle =
      this.values.shape === 'circle' || this.map.getMainShape() === 'circle'
    const { next, shape } = this.computeTargetBBox(
      current,
      areaKm2,
      mode,
      preferCircle,
      this.map.getMapCenter(),
      this.map.getMainShape(),
    )
    this.map.setMainBBox(next, shape)
    this.map.fitBBox(next)
    this.mainBBox = next
    const shown = this.formatArea(bboxAreaKm2(next))
    this.panel.setStatus(`已将主区域设为约 ${shown} km²（${modeLabel}）`)
    this.panel.setCurrentArea(bboxAreaKm2(next), true)
    this.updateMeta()
  }

  private formatArea(areaKm2: number): string {
    if (areaKm2 >= 100) return areaKm2.toFixed(1)
    if (areaKm2 >= 1) return areaKm2.toFixed(2)
    return areaKm2.toFixed(3)
  }

  private updateMapHud(zoom = this.map.getZoom(), centerLat = this.map.getCenterLat()): void {
    const primary = this.root.querySelector('#map-hud-primary')
    const secondary = this.root.querySelector('#map-hud-secondary')
    const mapTitle = this.root.querySelector('#map-pane-title')
    const z = Math.round(zoom)
    const view = describePrecision(z, 'texture', centerLat)
    const shapeLabel = this.values.shape === 'circle' ? '圆形' : '矩形'
    const modeTip =
      this.values.drawMode === 'patch'
        ? `局部精度 · ${shapeLabel} · Shift 新增多块，单击后可拖动`
        : this.values.drawMode === 'main'
          ? `主区域 · ${shapeLabel} · Shift 框选，拖锚点调整`
          : '仅浏览 · 拖地图 / 滚轮缩放'

    if (mapTitle) {
      mapTitle.textContent =
        this.values.drawMode === 'patch'
          ? `局部精度 · 视野 z${z}`
          : this.values.drawMode === 'main'
            ? `主区域 · 视野 z${z}`
            : `仅浏览 · 视野 z${z}`
    }

    if (primary) {
      if (!this.mainBBox) {
        primary.textContent = '选区面积 —'
      } else {
        const area = bboxAreaKm2(this.mainBBox)
        const patches =
          this.patches.length > 0 ? ` · 局部 ${this.patches.length} 块` : ''
        primary.textContent = `选区面积 ${this.formatArea(area)} km²${patches}`
      }
    }

    if (secondary) {
      secondary.textContent = `${modeTip} · 视野 z${z} ${view.label}（${view.level}）`
    }
  }

  private updateMeta(forceArea = false): void {
    this.updateMapHud()
    if (this.values.drawMode === 'patch') {
      const selected = this.map.getSelectedPatch()
      this.panel.setCurrentArea(
        selected ? bboxAreaKm2(selected.bbox) : null,
        forceArea,
      )
    } else if (this.mainBBox) {
      this.panel.setCurrentArea(bboxAreaKm2(this.mainBBox), forceArea)
    } else {
      this.panel.setCurrentArea(null, forceArea)
    }

    if (!this.mainBBox) {
      this.panel.setTileEstimate('请先框选区域', 'ok')
      return
    }
    const demTiles = countTiles(this.mainBBox, this.values.demZoom)
    const texTiles = countTiles(this.mainBBox, this.values.textureZoom)
    const area = bboxAreaKm2(this.mainBBox)

    let patchTiles = 0
    for (const patch of this.patches) {
      const clipped = bboxIntersect(this.mainBBox, patch.bbox)
      if (!clipped) continue
      patchTiles += countTiles(clipped, this.values.patchZoom)
    }

    const totalTex = texTiles + patchTiles
    const level =
      totalTex > 120 || demTiles > 80
        ? 'danger'
        : totalTex > 60 || demTiles > 40
          ? 'warn'
          : 'ok'

    const focusingPatch = this.values.drawMode === 'patch'
    this.panel.setTileEstimate(
      focusingPatch
        ? `<div>局部约 <strong>${patchTiles || 0}</strong> 张 · 整区约 <strong>${texTiles}</strong> 张</div>`
        : `<div>DEM <strong>${demTiles}</strong> · 贴图 <strong>${texTiles}</strong> · 合计 <strong>${demTiles + totalTex}</strong> 张</div>
           <div class="muted">${this.formatArea(area)} km² · z+1 ≈ 瓦片×4</div>`,
      level,
    )
  }

  private applySearchHit(
    item: { displayName: string; lat: number; lng: number },
    bbox: {
      west: number
      south: number
      east: number
      north: number
    } | null,
  ): void {
    this.map.setView(item.lat, item.lng, 12)
    if (bbox) {
      this.map.setMainBBox(bbox)
      this.map.fitBBox(bbox)
    } else {
      const pad = 0.04
      this.map.setMainBBox({
        west: item.lng - pad,
        south: item.lat - pad,
        east: item.lng + pad,
        north: item.lat + pad,
      })
    }
    this.panel.setStatus(`已定位：${item.displayName}`)
  }

  private async handleSearch(): Promise<void> {
    // 始终从面板读取最新输入，避免沿用初始默认值
    const v = this.panel.getValues()
    this.values = v

    try {
      if (v.searchMode === 'coords') {
        const lat = Number(v.lat)
        const lng = Number(v.lng)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          this.panel.setStatus('请输入有效的纬度和经度数字')
          return
        }
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          this.panel.setStatus('纬度需在 -90~90，经度需在 -180~180')
          return
        }
        this.panel.setStatus('定位中…')
        const pad = 0.05
        const hit = {
          displayName: `纬度 ${lat.toFixed(5)}，经度 ${lng.toFixed(5)}`,
          lat,
          lng,
        }
        this.lastSearch = [
          {
            ...hit,
            bbox: {
              west: lng - pad,
              south: lat - pad,
              east: lng + pad,
              north: lat + pad,
            },
          },
        ]
        renderSearchResults(this.root.querySelector('#sidebar')!, [], () => {})
        this.applySearchHit(hit, this.lastSearch[0]!.bbox)
        return
      }

      const q = v.query
      if (!q) {
        this.panel.setStatus('请输入城市或地名')
        return
      }
      this.panel.setStatus(`搜索「${q}」…`)
      this.lastSearch = await geocode(q)
      if (this.lastSearch.length === 0) {
        this.panel.setStatus(`未找到「${q}」`)
        renderSearchResults(this.root.querySelector('#sidebar')!, [], () => {})
        return
      }
      renderSearchResults(
        this.root.querySelector('#sidebar')!,
        this.lastSearch,
        (item, index) => {
          const full = this.lastSearch[index]!
          this.applySearchHit(item, full.bbox)
        },
      )
      // 多结果时默认选中第一条，同时列出其余供切换
      if (this.lastSearch.length === 1) {
        const only = this.lastSearch[0]!
        this.applySearchHit(only, only.bbox)
      } else {
        this.panel.setStatus(`找到 ${this.lastSearch.length} 条结果，点击选用`)
      }
    } catch (err) {
      this.panel.setStatus(
        err instanceof Error ? err.message : '搜索失败',
      )
    }
  }

  private async handleGenerate(): Promise<void> {
    this.values = this.panel.getValues()
    const bbox = this.mainBBox ?? this.map.getMainBBox()
    if (!bbox) {
      this.panel.setStatus('请先框选主区域（Shift+拖拽）')
      return
    }
    this.mainBBox = bbox
    this.patches = this.map.getPatches()

    const provider = getProvider(this.values.providerId)
    if (provider.needsKey && !this.values.mapboxToken) {
      this.panel.setStatus('该贴图源需要 Mapbox Token')
      return
    }

    this.panel.setBusy(true)
    this.panel.setProgress(0, 1)
    this.view.showLoading('正在生成地形')
    try {
      const { samplesX, samplesY } = resolveSampleSize(
        bbox,
        this.values.demZoom,
        this.values.maxEdge,
      )
      const demMsg = `拉取 DEM（${samplesX}×${samplesY}）…`
      this.panel.setStatus(demMsg)
      this.view.setLoadingProgress(0.02, demMsg)

      this.heightGrid = await fetchHeightGrid(
        bbox,
        this.values.demZoom,
        samplesX,
        samplesY,
        (done, total) => {
          const ratio = (done / Math.max(1, total)) * 0.45
          this.panel.setProgress(done, total * 2)
          const msg = `DEM 瓦片 ${done}/${total}`
          this.panel.setStatus(msg)
          this.view.setLoadingProgress(ratio, msg)
        },
      )

      this.panel.setStatus('生成网格…')
      this.view.setLoadingProgress(0.48, '生成网格…')
      this.view.clearTerrain()
      disposeTerrain(this.terrainMesh)
      const mainShape = this.map.getMainShape()
      const built = buildTerrainMesh(
        this.heightGrid,
        this.values.verticalExaggeration,
        mainShape,
      )
      this.terrainMesh = built.mesh
      // 先不上屏，等贴图完成再一起显示
      this.terrainMesh.visible = false

      this.panel.setStatus('拉取卫星贴图…')
      this.view.setLoadingProgress(0.5, '拉取卫星贴图…')
      const atlas = await buildTextureAtlas(bbox, {
        providerId: this.values.providerId,
        baseZoom: this.values.textureZoom,
        patches: this.patches,
        maxSize: 4096,
        shape: mainShape,
        onProgress: (done, total) => {
          const ratio = 0.5 + (done / Math.max(1, total)) * 0.45
          this.panel.setProgress(total + done, total * 2)
          const msg = `贴图瓦片 ${done}/${total}`
          this.panel.setStatus(msg)
          this.view.setLoadingProgress(ratio, msg)
        },
      })
      applyTexture(this.terrainMesh, atlas)
      this.view.setLoadingProgress(0.98, '装载模型…')
      this.view.setTerrain(this.terrainMesh)

      this.panel.setProgress(1, 1)
      this.view.setLoadingProgress(1, '完成')
      this.panel.setStatus(
        `完成 · 高程 ${built.minElev.toFixed(0)}–${built.maxElev.toFixed(0)} m · ${samplesX}×${samplesY} 顶点`,
      )
      this.updateMeta()
      // 稍留完成态再揭开
      await new Promise((r) => setTimeout(r, 280))
    } catch (err) {
      console.error(err)
      this.panel.setStatus(
        err instanceof Error ? err.message : '生成失败',
      )
      this.view.setLoadingProgress(0, '生成失败')
    } finally {
      this.view.hideLoading()
      this.panel.setBusy(false)
    }
  }

  private async handleRebuildTexture(): Promise<void> {
    this.values = this.panel.getValues()
    if (!this.terrainMesh || !this.mainBBox) {
      this.panel.setStatus('请先生成地形')
      return
    }
    // 重建时用当前「局部贴图精度」滑条覆盖已有 patch，便于不重画就改精度
    this.patches = this.map.getPatches().map((p) => ({
      ...p,
      textureZoom: this.values.patchZoom,
    }))

    const provider = getProvider(this.values.providerId)
    if (provider.needsKey && !this.values.mapboxToken) {
      this.panel.setStatus('该贴图源需要 Mapbox Token')
      return
    }

    this.panel.setBusy(true)
    this.view.showLoading('正在重建贴图')
    try {
      this.panel.setStatus('重建贴图…')
      this.view.setLoadingProgress(0.05, '重建贴图…')
      const atlas = await buildTextureAtlas(this.mainBBox, {
        providerId: this.values.providerId,
        baseZoom: this.values.textureZoom,
        patches: this.patches,
        maxSize: 4096,
        shape: this.map.getMainShape(),
        onProgress: (done, total) => {
          const ratio = done / Math.max(1, total)
          this.panel.setProgress(done, total)
          const msg = `贴图瓦片 ${done}/${total}`
          this.panel.setStatus(msg)
          this.view.setLoadingProgress(ratio, msg)
        },
      })
      applyTexture(this.terrainMesh, atlas)
      this.panel.setProgress(1, 1)
      this.view.setLoadingProgress(1, '完成')
      this.panel.setStatus('贴图已更新')
      this.updateMeta()
      await new Promise((r) => setTimeout(r, 220))
    } catch (err) {
      this.panel.setStatus(
        err instanceof Error ? err.message : '贴图重建失败',
      )
    } finally {
      this.view.hideLoading()
      this.panel.setBusy(false)
    }
  }

  private async handleExportGlb(): Promise<void> {
    if (!this.terrainMesh) {
      this.panel.setStatus('请先生成地形')
      return
    }
    try {
      this.panel.setStatus('导出 GLB（压缩贴图中）…')
      const buf = await exportGLB(this.terrainMesh)
      downloadArrayBuffer(buf, 'terrain.glb')
      this.panel.setStatus(`已下载 terrain.glb（${formatBytes(buf.byteLength)}）`)
    } catch (err) {
      this.panel.setStatus(
        err instanceof Error ? err.message : 'GLB 导出失败',
      )
    }
  }

  private async handleExportObj(): Promise<void> {
    if (!this.terrainMesh) {
      this.panel.setStatus('请先生成地形')
      return
    }
    try {
      this.panel.setStatus('打包 OBJ + 压缩贴图…')
      const blob = await exportObjZip(this.terrainMesh, 'terrain')
      this.panel.setStatus(`已下载 terrain_obj.zip（${formatBytes(blob.size)}）`)
    } catch (err) {
      this.panel.setStatus(
        err instanceof Error ? err.message : 'OBJ 导出失败',
      )
    }
  }

  private handleExportStl(): void {
    if (!this.terrainMesh) {
      this.panel.setStatus('请先生成地形')
      return
    }
    const blob = exportSTL(this.terrainMesh, 'terrain')
    this.panel.setStatus(`已下载 terrain.stl（${formatBytes(blob.size)}）`)
  }

  private async handleExportTexture(): Promise<void> {
    if (!this.terrainMesh) {
      this.panel.setStatus('请先生成地形')
      return
    }
    try {
      const blob = await exportTexturePng(this.terrainMesh)
      this.panel.setStatus(`已下载贴图（${formatBytes(blob.size)}）`)
    } catch (err) {
      this.panel.setStatus(
        err instanceof Error ? err.message : '贴图导出失败',
      )
    }
  }
}
