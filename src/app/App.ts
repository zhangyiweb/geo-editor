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
import {
  downloadArrayBuffer,
  downloadText,
  exportGLB,
  formatBytes,
} from '../export/exportGLTF'
import { exportStamp } from '../export/filename'
import { exportTerrainPack } from '../export/exportPack'
import { exportRunnableProject } from '../export/exportRunnableProject'
import { exportSTL, exportTexturePng } from '../export/exportZip'
import {
  buildTerrainMeta,
  terrainMetaToJson,
} from '../sdk/terrainMeta'
import {
  createProject,
  parseProjectJson,
  projectToJson,
} from '../sdk/projectFile'
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
  private lastBuilt: {
    minElev: number
    maxElev: number
    widthMeters: number
    depthMeters: number
  } | null = null
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
      verticalExaggeration: 1,
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
          <div class="map-stats" id="map-stats">
            <div class="map-stats-line map-stats-tiles" id="map-stats-tiles">
              瓦片预估：请先框选区域
            </div>
            <div class="map-stats-line map-stats-dem" id="map-stats-dem">
              当前 DEM：—
            </div>
          </div>
        </section>
        <section class="view-pane is-pip" id="view-pane" title="点击放大三维预览">
          <button type="button" class="view-fs-btn" id="view-fs-btn" title="浏览器全屏查看" aria-label="浏览器全屏查看">
            <span class="view-fs-icon" aria-hidden="true"></span>
          </button>
          <button type="button" class="pip-toggle-btn" id="view-pip-toggle" title="收起三维预览" aria-label="收起三维预览">
            <span class="pip-toggle-icon" aria-hidden="true">›</span>
          </button>
          <div class="pane-title">三维预览</div>
          <div id="view3d" class="view3d"></div>
        </section>
      </main>
      <dialog class="export-dialog" id="export-dialog">
        <form method="dialog" class="export-dialog-card">
          <header class="export-dialog-header">
            <h2>选择导出</h2>
            <button type="submit" class="export-dialog-close" value="cancel" aria-label="关闭">×</button>
          </header>
          <p class="export-dialog-hint">生成地形后再导出。</p>
          <div class="export-dialog-list">
            <section class="export-group export-group-panel">
              <h3 class="export-group-title">预览项目</h3>
              <p class="export-group-desc">本地起服务即可查看；改地形后重新导出覆盖即可。</p>
              <button type="button" class="export-option export-option-primary" data-export="viewer">
                <strong>可运行项目包</strong>
                <span>ZIP：index.html + assets/models/terrain.glb（网格与贴图已合成）。解压后执行 npx serve . 即可预览。</span>
              </button>
            </section>
            <section class="export-group export-group-panel">
              <h3 class="export-group-title">其它格式</h3>
              <p class="export-group-desc">通用交换格式，文件名带时间戳。</p>
              <div class="export-option-row">
                <button type="button" class="export-option" data-export="glb">
                  <strong>GLB 一体</strong>
                  <span>单文件网格 + JPEG 贴图，附 meta.json，方便拖进查看器。</span>
                </button>
                <button type="button" class="export-option" data-export="pack">
                  <strong>分包 ZIP</strong>
                  <span>时间戳命名的 glb + ktx2 + meta，适合接入自有 Three.js 工程。</span>
                </button>
              </div>
              <div class="export-option-row">
                <button type="button" class="export-option" data-export="stl">
                  <strong>STL 网格</strong>
                  <span>仅几何、无贴图，适合 3D 打印或 CAD 粗模。</span>
                </button>
                <button type="button" class="export-option" data-export="tex">
                  <strong>JPEG / PNG</strong>
                  <span>通用图片漫反射贴图，兼容性最好。</span>
                </button>
              </div>
            </section>
          </div>
        </form>
      </dialog>
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
      onOpenExport: () => this.openExportDialog(),
      onApplyArea: (areaKm2, mode) => this.handleApplyArea(areaKm2, mode),
      onSaveProject: () => this.handleSaveProject(),
      onLoadProject: (file) => void this.handleLoadProject(file),
      onChange: (v) => this.onPanelChange(v),
    })
    this.bindExportDialog()

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
    const fsBtn = workspace.querySelector('#view-fs-btn') as HTMLButtonElement

    const syncFsBtn = () => {
      const fs = viewPane.classList.contains('is-browser-fs')
      const collapsed = viewPane.classList.contains('is-collapsed')
      fsBtn.hidden = collapsed
      fsBtn.classList.toggle('is-exit', fs)
      fsBtn.title = fs ? '退出全屏' : '浏览器全屏查看'
      fsBtn.setAttribute('aria-label', fs ? '退出全屏' : '浏览器全屏查看')
    }

    const setBrowserFullscreen = (on: boolean) => {
      if (on && viewPane.classList.contains('is-collapsed')) {
        viewPane.classList.remove('is-collapsed')
        workspace.classList.remove('is-view-collapsed')
      }
      viewPane.classList.toggle('is-browser-fs', on)
      document.body.classList.toggle('view-browser-fs', on)
      syncFsBtn()
      syncToggleBtn()
      // 等布局生效后再改 WebGL 分辨率，避免小窗尺寸被拉伸发糊
      requestAnimationFrame(() => {
        this.view.resize()
        requestAnimationFrame(() => this.view.resize())
      })
    }

    const syncToggleBtn = () => {
      const collapsed = viewPane.classList.contains('is-collapsed')
      const isPip = viewPane.classList.contains('is-pip')
      const fs = viewPane.classList.contains('is-browser-fs')
      toggleBtn.hidden = (!isPip && !collapsed) || fs
      toggleBtn.title = collapsed ? '展开三维预览' : '收起三维预览'
      toggleBtn.setAttribute(
        'aria-label',
        collapsed ? '展开三维预览' : '收起三维预览',
      )
      toggleBtn.classList.toggle('is-collapsed', collapsed)
      syncFsBtn()
    }

    const setCollapsed = (collapsed: boolean) => {
      if (collapsed && viewPane.classList.contains('is-browser-fs')) {
        setBrowserFullscreen(false)
      }
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

    fsBtn.addEventListener('click', (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      setBrowserFullscreen(!viewPane.classList.contains('is-browser-fs'))
    })

    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return
      if (!viewPane.classList.contains('is-browser-fs')) return
      setBrowserFullscreen(false)
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
        if (viewPane.classList.contains('is-browser-fs')) return
        const t = ev.target as HTMLElement
        if (t.closest('.view3d-toolbar')) return
        if (t.closest('.patch-delete-btn')) return
        if (t.closest('.pip-toggle-btn')) return
        if (t.closest('.view-fs-btn')) return
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
      // 再等一帧，确保收起→展开后的布局尺寸已落地
      requestAnimationFrame(() => this.view.resize())
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
      } else {
        this.panel.setStatus('主区域：Shift 框选，拖锚点调整')
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
    const mapTitle = this.root.querySelector('#map-pane-title')
    const tilesEl = this.root.querySelector('#map-stats-tiles')
    const demEl = this.root.querySelector('#map-stats-dem')
    const statsEl = this.root.querySelector('#map-stats') as HTMLElement | null
    const z = Math.round(zoom)
    const shapeLabel = this.values.shape === 'circle' ? '圆形' : '矩形'

    if (mapTitle) {
      const modeTip =
        this.values.drawMode === 'patch'
          ? `局部精度 · ${shapeLabel} · Shift 新增多块`
          : `主区域 · ${shapeLabel} · Shift 框选`
      mapTitle.textContent = `${modeTip} · 视野 z${z}`
    }

    const dem = describePrecision(
      this.values.demZoom,
      'dem',
      centerLat,
    )
    if (demEl) demEl.textContent = `当前 DEM：${dem.detail}`

    if (!this.mainBBox) {
      if (tilesEl) tilesEl.textContent = '瓦片预估：请先框选区域'
      if (statsEl) statsEl.dataset.level = 'ok'
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
    if (statsEl) statsEl.dataset.level = level

    if (tilesEl) {
      tilesEl.innerHTML =
        this.values.drawMode === 'patch'
          ? `瓦片预估：局部 <strong>${patchTiles || 0}</strong> · 整区 <strong>${texTiles}</strong> 张`
          : `瓦片预估：DEM <strong>${demTiles}</strong> · 贴图 <strong>${texTiles}</strong> · 合计 <strong>${demTiles + totalTex}</strong> 张 · ${this.formatArea(area)} km² · z+1 ≈ ×4`
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
      this.lastBuilt = {
        minElev: built.minElev,
        maxElev: built.maxElev,
        widthMeters: built.widthMeters,
        depthMeters: built.heightMeters,
      }
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
        `完成 · 真实海拔 ${built.minElev.toFixed(0)}–${built.maxElev.toFixed(0)} m · ${samplesX}×${samplesY} 顶点`,
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
      this.panel.setExportEnabled(!!this.terrainMesh)
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

  private openExportDialog(): void {
    const dialog = this.root.querySelector('#export-dialog') as HTMLDialogElement | null
    dialog?.showModal()
  }

  private bindExportDialog(): void {
    const dialog = this.root.querySelector('#export-dialog') as HTMLDialogElement
    dialog.querySelectorAll<HTMLButtonElement>('[data-export]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.export
        dialog.close()
        if (kind === 'glb') void this.handleExportGlb()
        else if (kind === 'pack') void this.handleExportPack()
        else if (kind === 'viewer') void this.handleExportViewer()
        else if (kind === 'stl') this.handleExportStl()
        else if (kind === 'tex') void this.handleExportTexture()
      })
    })
    dialog.addEventListener('click', (ev) => {
      if (ev.target === dialog) dialog.close()
    })
  }

  private getExportContext() {
    const bbox = this.mainBBox ?? this.map.getMainBBox()
    const built = this.lastBuilt
    if (!this.terrainMesh || !bbox || !built) return null
    return {
      demZoom: this.values.demZoom,
      textureZoom: this.values.textureZoom,
      providerId: this.values.providerId,
      verticalExaggeration: this.values.verticalExaggeration,
      minElev: built.minElev,
      maxElev: built.maxElev,
      widthMeters: built.widthMeters,
      depthMeters: built.depthMeters,
      bbox,
      shape: this.map.getMainShape(),
    }
  }

  private async handleExportGlb(): Promise<void> {
    if (!this.terrainMesh) {
      this.panel.setStatus('请先生成地形')
      return
    }
    const ctx = this.getExportContext()
    if (!ctx) {
      this.panel.setStatus('缺少选区或高程信息，请重新生成')
      return
    }
    try {
      this.panel.setBusy(true)
      this.panel.setStatus('导出 GLB一体（嵌入 JPEG 贴图）…')
      const stamp = exportStamp()
      const buf = await exportGLB(this.terrainMesh)
      downloadArrayBuffer(buf, `${stamp}.glb`)
      const meta = buildTerrainMeta({
        ...ctx,
        basename: stamp,
        textureExt: 'jpg',
      })
      downloadText(terrainMetaToJson(meta), `${stamp}.meta.json`)
      this.panel.setStatus(
        `已下载 ${stamp}.glb + meta（${formatBytes(buf.byteLength)}）`,
      )
    } catch (err) {
      this.panel.setStatus(
        err instanceof Error ? err.message : 'GLB 导出失败',
      )
    } finally {
      this.panel.setBusy(false)
    }
  }

  private async handleExportPack(): Promise<void> {
    if (!this.terrainMesh) {
      this.panel.setStatus('请先生成地形')
      return
    }
    const ctx = this.getExportContext()
    if (!ctx) {
      this.panel.setStatus('缺少选区或高程信息，请重新生成')
      return
    }
    try {
      this.panel.setBusy(true)
      this.panel.setStatus('分包导出中（几何 GLB + KTX2 + meta）…')
      const stamp = exportStamp()
      const result = await exportTerrainPack(this.terrainMesh, stamp, ctx)
      const texHint =
        result.textureFormat === 'ktx2'
          ? 'KTX2'
          : result.textureFormat === 'none'
            ? '无贴图'
            : result.textureFormat.toUpperCase()
      this.panel.setStatus(
        `已下载 ${stamp}_pack.zip（${formatBytes(result.blob.size)} · 网格 ${formatBytes(result.geometryBytes)} · 贴图 ${texHint} ${formatBytes(result.textureBytes)} · 含 meta）`,
      )
    } catch (err) {
      this.panel.setStatus(
        err instanceof Error ? err.message : '分包导出失败',
      )
    } finally {
      this.panel.setBusy(false)
    }
  }

  private async handleExportViewer(): Promise<void> {
    if (!this.terrainMesh) {
      this.panel.setStatus('请先生成地形')
      return
    }
    const ctx = this.getExportContext()
    if (!ctx) {
      this.panel.setStatus('缺少选区或高程信息，请重新生成')
      return
    }
    try {
      this.panel.setBusy(true)
      this.panel.setStatus('导出可运行项目包（一体 GLB）…')
      const result = await exportRunnableProject(this.terrainMesh, ctx)
      this.panel.setStatus(
        `已下载 terrain_viewer.zip（${formatBytes(result.blob.size)}）· 解压后 npx serve . 预览`,
      )
    } catch (err) {
      this.panel.setStatus(
        err instanceof Error ? err.message : '可运行项目包导出失败',
      )
    } finally {
      this.panel.setBusy(false)
    }
  }

  private handleSaveProject(): void {
    this.values = this.panel.getValues()
    const mainBBox = this.mainBBox ?? this.map.getMainBBox()
    const center = this.map.getMapCenter()
    const project = createProject({
      panel: this.values,
      main: mainBBox
        ? { bbox: mainBBox, shape: this.map.getMainShape() }
        : null,
      patches: this.map.getPatches(),
      mapView: {
        lat: center.lat,
        lng: center.lng,
        zoom: this.map.getZoom(),
      },
    })
    const stamp = exportStamp()
    downloadText(projectToJson(project), `${stamp}_project.json`)
    this.panel.setStatus(`已保存项目 ${stamp}_project.json`)
  }

  private async handleLoadProject(file: File): Promise<void> {
    try {
      const text = await file.text()
      const project = parseProjectJson(text)
      this.values = { ...project.panel }
      setMapboxToken(this.values.mapboxToken)
      this.panel.setValues(this.values)
      this.map.setDrawMode(this.values.drawMode)
      this.map.setShape(this.values.shape)
      this.map.setPatchZoom(this.values.patchZoom)
      this.panel.setModeHelp(this.values.drawMode)

      if (project.main) {
        this.map.setMainBBox(project.main.bbox, project.main.shape)
        this.mainBBox = this.map.getMainBBox()
      } else {
        this.mainBBox = null
      }
      this.map.setPatches(project.patches)
      this.patches = this.map.getPatches()
      this.map.setView(
        project.mapView.lat,
        project.mapView.lng,
        project.mapView.zoom,
      )
      if (project.main) this.map.fitBBox(project.main.bbox)

      this.view.clearTerrain()
      disposeTerrain(this.terrainMesh)
      this.terrainMesh = null
      this.heightGrid = null
      this.lastBuilt = null
      this.panel.setExportEnabled(false)
      this.updateMeta(true)
      this.panel.setStatus(
        `已打开项目（${project.savedAt.slice(0, 19).replace('T', ' ')}），请重新生成地形`,
      )
    } catch (err) {
      this.panel.setStatus(
        err instanceof Error ? err.message : '打开项目失败',
      )
    }
  }

  private handleExportStl(): void {
    if (!this.terrainMesh) {
      this.panel.setStatus('请先生成地形')
      return
    }
    const stamp = exportStamp()
    const blob = exportSTL(this.terrainMesh, stamp)
    this.panel.setStatus(`已下载 ${stamp}.stl（${formatBytes(blob.size)}）`)
  }

  private async handleExportTexture(): Promise<void> {
    if (!this.terrainMesh) {
      this.panel.setStatus('请先生成地形')
      return
    }
    try {
      const stamp = exportStamp()
      const blob = await exportTexturePng(this.terrainMesh, stamp)
      this.panel.setStatus(`已下载贴图（${formatBytes(blob.size)}）`)
    } catch (err) {
      this.panel.setStatus(
        err instanceof Error ? err.message : '贴图导出失败',
      )
    }
  }
}
