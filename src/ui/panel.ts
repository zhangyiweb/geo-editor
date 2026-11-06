import { describePrecision } from '../geo/precision'
import { IMAGERY_PROVIDERS } from '../geo/providers'

export type SearchMode = 'place' | 'coords'

export type PanelValues = {
  searchMode: SearchMode
  query: string
  lat: string
  lng: string
  providerId: string
  demZoom: number
  textureZoom: number
  patchZoom: number
  verticalExaggeration: number
  maxEdge: number
  mapboxToken: string
  drawMode: 'main' | 'patch'
  shape: 'rect' | 'circle'
}

export type PanelCallbacks = {
  onSearch: () => void
  onGenerate: () => void
  onRebuildTexture: () => void
  onOpenExport: () => void
  onOpenTextureStudio: () => void
  onApplyArea: (areaKm2: number, mode: 'keep-ratio' | 'square') => void
  onSaveProject: () => void
  onLoadProject: (file: File) => void
  onChange: (values: PanelValues) => void
}

export function mountPanel(
  root: HTMLElement,
  initial: PanelValues,
  callbacks: PanelCallbacks,
): {
  getValues: () => PanelValues
  setValues: (values: PanelValues) => void
  setStatus: (text: string) => void
  setProgress: (done: number, total: number) => void
  setBusy: (busy: boolean) => void
  setExportEnabled: (enabled: boolean) => void
  setTextureStudioEnabled: (enabled: boolean) => void
  setTileEstimate: (html: string, level?: 'ok' | 'warn' | 'danger') => void
  setModeHelp: (mode: PanelValues['drawMode']) => void
  setMapViewPrecision: (zoom: number, latitude?: number) => void
  setCurrentArea: (areaKm2: number | null, force?: boolean) => void
} {
  root.innerHTML = `
    <header class="panel-header">
      <h1>地理编辑器</h1>
      <p class="subtitle">Three.js · DEM · 卫星贴图</p>
    </header>

    <section class="panel-section">
      <label class="field-label">查询方式</label>
      <div class="seg search-mode-seg">
        <button type="button" data-search-mode="place" class="seg-btn search-mode-btn active">地名查询</button>
        <button type="button" data-search-mode="coords" class="seg-btn search-mode-btn">经纬度查询</button>
      </div>

      <div id="place-fields" class="search-fields">
        <label class="field-label mt">城市 / 地名</label>
        <div class="row">
          <input id="query" type="text" placeholder="例如：合肥、黄山、西湖" autocomplete="off" />
          <button id="btn-search" type="button" class="btn primary">搜索</button>
        </div>
      </div>

      <div id="coords-fields" class="search-fields hidden">
        <label class="field-label mt">经纬度（十进制度）</label>
        <div class="coords-stack">
          <div class="coord-line">
            <span class="coord-tag" title="Latitude">北纬 (N)</span>
            <input id="lat" type="text" inputmode="decimal" placeholder="如 31.8206" />
          </div>
          <div class="coord-line">
            <span class="coord-tag" title="Longitude">东经 (E)</span>
            <input id="lng" type="text" inputmode="decimal" placeholder="如 117.2272" />
          </div>
        </div>
        <button id="btn-goto-coords" type="button" class="btn primary block mt-btn">定位</button>
        <p class="hint">中国大致范围：北纬 18–53，东经 73–135</p>
      </div>

      <ul id="search-results" class="search-results"></ul>
    </section>

    <section class="panel-section">
      <label class="field-label">框选模式</label>
      <div class="seg">
        <button type="button" data-mode="main" class="seg-btn active">主区域</button>
        <button type="button" data-mode="patch" class="seg-btn">局部精度</button>
      </div>
      <label class="field-label mt">选区形状</label>
      <div class="seg shape-seg">
        <button type="button" data-shape="rect" class="seg-btn active">矩形</button>
        <button type="button" data-shape="circle" class="seg-btn">圆形</button>
      </div>

      <div id="area-tools" class="area-tools">
        <label class="field-label mt" id="area-label">主区域面积</label>
        <div class="area-field">
          <div class="area-input-wrap">
            <input id="target-area" type="number" min="0.01" step="0.1" placeholder="目标面积" />
            <span class="area-unit">km²</span>
          </div>
          <button id="btn-apply-area" type="button" class="btn primary">应用</button>
        </div>
        <div class="seg area-mode-seg">
          <button type="button" data-area-mode="keep-ratio" class="seg-btn active">保持比例</button>
          <button type="button" data-area-mode="square" class="seg-btn" id="area-square-btn">正方形</button>
        </div>
      </div>
    </section>

    <section class="panel-section">
      <label class="field-label">卫星贴图源</label>
      <select id="provider"></select>
      <label class="field-label mt">Mapbox Token（可选）</label>
      <input id="mapbox-token" type="password" placeholder="仅 Mapbox 源需要" />
    </section>

    <section class="panel-section">
      <label class="field-label" id="precision-section-label">主区域参数</label>

      <div id="main-precision-fields" class="precision-fields grid-2">
        <div>
          <label class="field-label">DEM 高度精度 (z)</label>
          <input id="dem-zoom" type="range" min="8" max="15" step="1" />
          <span id="dem-zoom-val" class="val"></span>
        </div>
        <div>
          <label class="field-label">网格上限</label>
          <input id="max-edge" type="range" min="64" max="1024" step="64" />
          <span id="max-edge-val" class="val"></span>
        </div>
        <div class="span-2">
          <label class="field-label">整区贴图精度 (z)</label>
          <input id="tex-zoom" type="range" min="10" max="18" step="1" />
          <span id="tex-zoom-val" class="val"></span>
        </div>
        <p class="precision-badge span-2" id="tex-precision-badge"></p>
        <div class="span-2">
          <label class="field-label">垂直夸张（真实海拔 ×）</label>
          <input id="vert" type="range" min="0.5" max="5" step="0.1" />
          <span id="vert-val" class="val"></span>
        </div>
        <p class="hint span-2">顶点 Y 使用真实海拔（米）；夸张=1 即为原海拔。</p>
      </div>

      <div id="patch-precision-fields" class="precision-fields hidden">
        <label class="field-label">局部贴图精度 (z)</label>
        <input id="patch-zoom" type="range" min="12" max="18" step="1" />
        <span id="patch-zoom-val" class="val"></span>
        <p class="precision-badge" id="patch-precision-badge"></p>
      </div>
    </section>

    <section class="panel-section actions">
      <button id="btn-generate" type="button" class="btn primary block">生成地形</button>
      <button id="btn-rebuild-tex" type="button" class="btn block">仅重建贴图</button>
      <button id="btn-texture-studio" type="button" class="btn block" title="请先生成地形" disabled>贴图精修</button>
      <button id="btn-export" type="button" class="btn block" title="请先生成地形" disabled>导出</button>
      <div class="row project-row">
        <button id="btn-save-project" type="button" class="btn ghost" title="保存选区与参数为 JSON">保存项目</button>
        <button id="btn-load-project" type="button" class="btn ghost" title="从 JSON 恢复选区与参数">打开项目</button>
      </div>
      <input id="project-file" type="file" accept="application/json,.json" hidden />
    </section>

    <section class="panel-section">
      <div class="progress-wrap">
        <div id="progress-bar" class="progress-bar"></div>
      </div>
      <p id="status" class="status">就绪</p>
    </section>
  `

  const $ = <T extends HTMLElement>(id: string) =>
    root.querySelector(`#${id}`) as T

  const query = $<HTMLInputElement>('query')
  const lat = $<HTMLInputElement>('lat')
  const lng = $<HTMLInputElement>('lng')
  const placeFields = $<HTMLDivElement>('place-fields')
  const coordsFields = $<HTMLDivElement>('coords-fields')
  const provider = $<HTMLSelectElement>('provider')
  const demZoom = $<HTMLInputElement>('dem-zoom')
  const texZoom = $<HTMLInputElement>('tex-zoom')
  const patchZoom = $<HTMLInputElement>('patch-zoom')
  const maxEdge = $<HTMLInputElement>('max-edge')
  const vert = $<HTMLInputElement>('vert')
  const mapboxToken = $<HTMLInputElement>('mapbox-token')
  const status = $<HTMLParagraphElement>('status')
  const progressBar = $<HTMLDivElement>('progress-bar')
  const mainPrecisionFields = $<HTMLDivElement>('main-precision-fields')
  const patchPrecisionFields = $<HTMLDivElement>('patch-precision-fields')
  const precisionSectionLabel = $<HTMLElement>('precision-section-label')

  function applyPrecisionPanel(mode: PanelValues['drawMode']) {
    const isPatch = mode === 'patch'
    mainPrecisionFields.classList.toggle('hidden', isPatch)
    patchPrecisionFields.classList.toggle('hidden', !isPatch)
    precisionSectionLabel.textContent = isPatch ? '局部精度参数' : '主区域参数'

    const areaLabel = root.querySelector('#area-label') as HTMLElement | null
    const squareBtn = root.querySelector('#area-square-btn') as HTMLElement | null
    if (areaLabel) {
      areaLabel.textContent = isPatch ? '局部精度面积' : '主区域面积'
    }
    if (squareBtn) {
      squareBtn.textContent = shape === 'circle' ? '正圆' : '正方形'
    }
  }

  let searchMode: SearchMode = initial.searchMode
  let drawMode: PanelValues['drawMode'] = initial.drawMode
  let shape: PanelValues['shape'] = initial.shape
  let exportEnabled = false
  let textureStudioEnabled = false
  let panelBusy = false

  function syncExportButton() {
    const btn = root.querySelector('#btn-export') as HTMLButtonElement | null
    if (!btn) return
    const enabled = exportEnabled && !panelBusy
    btn.disabled = !enabled
    btn.title = enabled ? '选择导出格式' : '请先生成地形'
  }

  function syncTextureStudioButton() {
    const btn = root.querySelector(
      '#btn-texture-studio',
    ) as HTMLButtonElement | null
    if (!btn) return
    const enabled = textureStudioEnabled && !panelBusy
    btn.disabled = !enabled
    btn.title = enabled ? '上传 PS 贴图预览 / 导出' : '请先生成地形'
  }

  for (const p of IMAGERY_PROVIDERS) {
    const opt = document.createElement('option')
    opt.value = p.id
    opt.textContent = p.needsKey ? `${p.name}（需 Token）` : p.name
    provider.appendChild(opt)
  }

  function applySearchMode(mode: SearchMode) {
    searchMode = mode
    root.querySelectorAll('.search-mode-btn').forEach((btn) => {
      btn.classList.toggle(
        'active',
        (btn as HTMLElement).dataset.searchMode === mode,
      )
    })
    placeFields.classList.toggle('hidden', mode !== 'place')
    coordsFields.classList.toggle('hidden', mode !== 'coords')
    const results = root.querySelector('#search-results') as HTMLUListElement
    if (mode === 'coords') results.innerHTML = ''
  }

  function applyValues(v: PanelValues) {
    query.value = v.query
    lat.value = v.lat
    lng.value = v.lng
    provider.value = v.providerId
    demZoom.value = String(v.demZoom)
    texZoom.value = String(v.textureZoom)
    patchZoom.value = String(v.patchZoom)
    maxEdge.value = String(v.maxEdge)
    vert.value = String(v.verticalExaggeration)
    mapboxToken.value = v.mapboxToken
    applySearchMode(v.searchMode)
    syncDrawModeButtons(v.drawMode)
    syncShapeButtons(v.shape)
    syncLabels()
  }

  function applyInitial() {
    applyValues(initial)
  }

  function syncLabels() {
    $('dem-zoom-val').textContent = demZoom.value
    $('tex-zoom-val').textContent = texZoom.value
    $('patch-zoom-val').textContent = patchZoom.value
    $('max-edge-val').textContent = maxEdge.value
    $('vert-val').textContent = Number(vert.value).toFixed(1)

    const tex = describePrecision(Number(texZoom.value), 'texture')
    const patch = describePrecision(Number(patchZoom.value), 'texture')
    $('tex-precision-badge').textContent = `当前整区贴图：${tex.detail}`
    $('patch-precision-badge').textContent = `当前局部贴图：${patch.detail}`
  }

  function syncDrawModeButtons(mode: PanelValues['drawMode']) {
    drawMode = mode
    root
      .querySelectorAll('.panel-section .seg:not(.search-mode-seg):not(.shape-seg):not(.area-mode-seg) .seg-btn')
      .forEach((btn) => {
        const el = btn as HTMLElement
        if (!el.dataset.mode) return
        el.classList.toggle('active', el.dataset.mode === mode)
      })
    applyPrecisionPanel(mode)
  }

  function syncShapeButtons(next: PanelValues['shape']) {
    shape = next
    root.querySelectorAll('.shape-seg .seg-btn').forEach((btn) => {
      btn.classList.toggle(
        'active',
        (btn as HTMLElement).dataset.shape === next,
      )
    })
    const squareBtn = root.querySelector('#area-square-btn') as HTMLElement | null
    if (squareBtn) squareBtn.textContent = next === 'circle' ? '正圆' : '正方形'
  }

  function getValues(): PanelValues {
    return {
      searchMode,
      query: query.value.trim(),
      lat: lat.value.trim(),
      lng: lng.value.trim(),
      providerId: provider.value,
      demZoom: Number(demZoom.value),
      textureZoom: Number(texZoom.value),
      patchZoom: Number(patchZoom.value),
      verticalExaggeration: Number(vert.value),
      maxEdge: Number(maxEdge.value),
      mapboxToken: mapboxToken.value.trim(),
      drawMode,
      shape,
    }
  }

  function emit() {
    syncLabels()
    callbacks.onChange(getValues())
  }

  applyInitial()

  for (const el of [
    demZoom,
    texZoom,
    patchZoom,
    maxEdge,
    vert,
    provider,
    mapboxToken,
    query,
    lat,
    lng,
  ]) {
    el.addEventListener('input', emit)
    el.addEventListener('change', emit)
  }

  root.querySelectorAll('.search-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.searchMode as SearchMode
      applySearchMode(mode)
      emit()
    })
  })

  root
    .querySelectorAll(
      '.panel-section .seg:not(.search-mode-seg):not(.shape-seg):not(.area-mode-seg) .seg-btn',
    )
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = ((btn as HTMLElement).dataset.mode ??
          'main') as PanelValues['drawMode']
        if (!(btn as HTMLElement).dataset.mode) return
        syncDrawModeButtons(mode)
        emit()
      })
    })

  root.querySelectorAll('.shape-seg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = ((btn as HTMLElement).dataset.shape ??
        'rect') as PanelValues['shape']
      if (next === shape) return
      syncShapeButtons(next)
      emit()
    })
  })

  $('btn-search').addEventListener('click', () => callbacks.onSearch())
  $('btn-goto-coords').addEventListener('click', () => callbacks.onSearch())
  query.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') callbacks.onSearch()
  })
  lat.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') callbacks.onSearch()
  })
  lng.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') callbacks.onSearch()
  })
  $('btn-generate').addEventListener('click', () => callbacks.onGenerate())
  $('btn-rebuild-tex').addEventListener('click', () => callbacks.onRebuildTexture())
  $('btn-texture-studio').addEventListener('click', () =>
    callbacks.onOpenTextureStudio(),
  )
  $('btn-export').addEventListener('click', () => callbacks.onOpenExport())
  $('btn-save-project').addEventListener('click', () => callbacks.onSaveProject())
  const projectFile = $<HTMLInputElement>('project-file')
  $('btn-load-project').addEventListener('click', () => projectFile.click())
  projectFile.addEventListener('change', () => {
    const file = projectFile.files?.[0]
    projectFile.value = ''
    if (file) callbacks.onLoadProject(file)
  })
  let areaMode: 'keep-ratio' | 'square' = 'keep-ratio'
  root.querySelectorAll('.area-mode-seg .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.area-mode-seg .seg-btn').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      areaMode = ((btn as HTMLElement).dataset.areaMode ??
        'keep-ratio') as 'keep-ratio' | 'square'
    })
  })

  const applyArea = () => {
    const raw = ($<HTMLInputElement>('target-area').value || '').trim()
    const areaKm2 = Number(raw)
    if (!Number.isFinite(areaKm2) || areaKm2 <= 0) {
      status.textContent = '请输入大于 0 的面积（km²）'
      return
    }
    callbacks.onApplyArea(areaKm2, areaMode)
  }
  $('btn-apply-area').addEventListener('click', applyArea)
  $<HTMLInputElement>('target-area').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyArea()
  })

  return {
    getValues,
    setValues(values: PanelValues) {
      applyValues(values)
    },
    setStatus(text: string) {
      status.textContent = text
    },
    setProgress(done: number, total: number) {
      const pct = total <= 0 ? 0 : Math.round((done / total) * 100)
      progressBar.style.width = `${pct}%`
    },
    setBusy(busy: boolean) {
      panelBusy = busy
      root.classList.toggle('busy', busy)
      const keepEnabled = new Set(['btn-search', 'btn-goto-coords'])
      for (const btn of root.querySelectorAll('button')) {
        const el = btn as HTMLButtonElement
        if (el.id === 'btn-export' || el.id === 'btn-texture-studio') continue
        el.disabled = busy && !keepEnabled.has(el.id)
      }
      syncExportButton()
      syncTextureStudioButton()
    },
    setExportEnabled(enabled: boolean) {
      exportEnabled = enabled
      syncExportButton()
    },
    setTextureStudioEnabled(enabled: boolean) {
      textureStudioEnabled = enabled
      syncTextureStudioButton()
    },
    setTileEstimate(_html: string, _level: 'ok' | 'warn' | 'danger' = 'ok') {
      // 瓦片预估已迁到地图左下角，由 App 更新
    },
    setModeHelp(mode: PanelValues['drawMode']) {
      applyPrecisionPanel(mode)
    },
    setMapViewPrecision(_zoom: number, _latitude = 30) {
      // 视野说明改到地图下方 HUD，由 App 更新
    },
    setCurrentArea(areaKm2: number | null, force = false) {
      const input = root.querySelector('#target-area') as HTMLInputElement | null
      if (!input) return
      if (areaKm2 == null || !Number.isFinite(areaKm2)) {
        input.placeholder =
          drawMode === 'patch' ? '选中黄框后设定面积' : '目标面积'
        if (force) input.value = ''
        return
      }
      const text =
        areaKm2 >= 100
          ? areaKm2.toFixed(1)
          : areaKm2 >= 1
            ? areaKm2.toFixed(2)
            : areaKm2.toFixed(3)
      input.placeholder = `当前 ${text}`
      if (force) input.value = text
    },
  }
}

export function renderSearchResults(
  root: HTMLElement,
  items: { displayName: string; lat: number; lng: number }[],
  onPick: (item: { displayName: string; lat: number; lng: number }, index: number) => void,
): void {
  const list = root.querySelector('#search-results') as HTMLUListElement
  list.innerHTML = ''
  items.forEach((item, index) => {
    const li = document.createElement('li')
    li.textContent = item.displayName
    li.addEventListener('click', () => onPick(item, index))
    list.appendChild(li)
  })
}
