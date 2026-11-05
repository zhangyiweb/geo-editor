import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export class SceneView {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private readonly container: HTMLElement
  private raf = 0
  private terrain: THREE.Object3D | null = null
  private gridHelper: THREE.GridHelper
  private wireframeEnabled = false
  private gridVisible = true
  private resizeObserver: ResizeObserver | null = null
  private lastDrawW = 0
  private lastDrawH = 0

  constructor(container: HTMLElement) {
    this.container = container
    this.container.classList.add('view3d-host')
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x0b1220)

    const w = container.clientWidth || 800
    const h = container.clientHeight || 600
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500_000)
    this.camera.position.set(0, 800, 1200)

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    container.appendChild(this.renderer.domElement)
    this.lastDrawW = w
    this.lastDrawH = h

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.maxPolarAngle = Math.PI * 0.49

    const hemi = new THREE.HemisphereLight(0xb1c4e0, 0x3d2b1f, 1.1)
    this.scene.add(hemi)
    const sun = new THREE.DirectionalLight(0xffffff, 1.2)
    sun.position.set(500, 1000, 300)
    sun.castShadow = true
    this.scene.add(sun)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.25))

    this.gridHelper = new THREE.GridHelper(2000, 40, 0x334155, 0x1e293b)
    this.gridHelper.name = 'grid'
    this.scene.add(this.gridHelper)

    this.mountOverlay()

    window.addEventListener('resize', this.onResize)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    // 也观察父级（view-pane）尺寸变化：收起/展开/全屏
    if (this.container.parentElement) {
      this.resizeObserver.observe(this.container.parentElement)
    }
    this.loop()
  }

  private loadingEl: HTMLElement | null = null
  private loadingBarEl: HTMLElement | null = null
  private loadingTextEl: HTMLElement | null = null
  private loadingPctEl: HTMLElement | null = null

  private mountOverlay(): void {
    const bar = document.createElement('div')
    bar.className = 'view3d-toolbar'
    bar.innerHTML = `
      <label class="view3d-switch" data-action="wireframe" title="线框显示">
        <span class="view3d-switch-label">线框</span>
        <button type="button" class="view3d-switch-track" role="switch" aria-checked="false">
          <span class="view3d-switch-thumb"></span>
        </button>
      </label>
      <label class="view3d-switch is-on" data-action="grid" title="网格显示">
        <span class="view3d-switch-label">网格</span>
        <button type="button" class="view3d-switch-track" role="switch" aria-checked="true">
          <span class="view3d-switch-thumb"></span>
        </button>
      </label>
    `
    this.container.appendChild(bar)

    bar.addEventListener('click', (ev) => {
      const row = (ev.target as HTMLElement).closest('.view3d-switch') as HTMLElement | null
      if (!row) return
      ev.preventDefault()
      const action = row.dataset.action
      if (action === 'wireframe') {
        this.setWireframe(!this.wireframeEnabled)
      } else if (action === 'grid') {
        this.setGridVisible(!this.gridVisible)
      }
    })

    const loading = document.createElement('div')
    loading.className = 'view3d-loading hidden'
    loading.innerHTML = `
      <div class="view3d-loading-card">
        <p class="view3d-loading-title">正在生成地形</p>
        <p class="view3d-loading-text">准备中…</p>
        <div class="view3d-loading-track">
          <div class="view3d-loading-bar"></div>
        </div>
        <p class="view3d-loading-pct">0%</p>
      </div>
    `
    this.container.appendChild(loading)
    this.loadingEl = loading
    this.loadingBarEl = loading.querySelector('.view3d-loading-bar')
    this.loadingTextEl = loading.querySelector('.view3d-loading-text')
    this.loadingPctEl = loading.querySelector('.view3d-loading-pct')
  }

  showLoading(title = '正在生成地形'): void {
    if (!this.loadingEl) return
    const titleEl = this.loadingEl.querySelector('.view3d-loading-title')
    if (titleEl) titleEl.textContent = title
    this.loadingEl.classList.remove('hidden')
    this.setLoadingProgress(0, '准备中…')
    // 生成期间先隐藏旧模型，完成后再显示新模型
    if (this.terrain) this.terrain.visible = false
    this.controls.enabled = false
  }

  setLoadingProgress(ratio: number, text?: string): void {
    const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)))
    if (this.loadingBarEl) this.loadingBarEl.style.width = `${pct}%`
    if (this.loadingPctEl) this.loadingPctEl.textContent = `${pct}%`
    if (text && this.loadingTextEl) this.loadingTextEl.textContent = text
  }

  hideLoading(): void {
    this.loadingEl?.classList.add('hidden')
    if (this.terrain) this.terrain.visible = true
    this.controls.enabled = true
  }

  private onResize = (): void => {
    this.resize()
  }

  resize(): void {
    const w = Math.round(this.container.clientWidth)
    const h = Math.round(this.container.clientHeight)
    // 收起成 40×40 时不要写入极低分辨率；并清空缓存，展开后强制重设
    if (w < 64 || h < 64) {
      this.lastDrawW = 0
      this.lastDrawH = 0
      return
    }
    if (w === this.lastDrawW && h === this.lastDrawH) return
    this.lastDrawW = w
    this.lastDrawH = h
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h, true)
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  clearTerrain(): void {
    if (!this.terrain) return
    this.scene.remove(this.terrain)
    this.terrain = null
  }

  setTerrain(mesh: THREE.Mesh): void {
    if (this.terrain) {
      this.scene.remove(this.terrain)
    }
    this.terrain = mesh
    mesh.visible = true
    this.scene.add(mesh)

    const box = new THREE.Box3().setFromObject(mesh)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    this.controls.target.copy(center)
    const dist = Math.max(size.x, size.z) * 0.9
    this.camera.position.set(center.x + dist * 0.4, dist * 0.65, center.z + dist * 0.7)
    this.camera.near = Math.max(0.1, dist / 1000)
    this.camera.far = dist * 50
    this.camera.updateProjectionMatrix()
    this.controls.update()

    this.gridHelper.scale.setScalar(Math.max(size.x, size.z) / 2000)
    this.setWireframe(this.wireframeEnabled)
  }

  getTerrain(): THREE.Object3D | null {
    return this.terrain
  }

  setWireframe(enabled: boolean): void {
    this.wireframeEnabled = enabled
    if (!this.terrain) return
    const mesh = this.terrain as THREE.Mesh
    const mat = mesh.material as THREE.MeshStandardMaterial
    mat.wireframe = enabled
    this.syncOverlayButtons()
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible
    this.gridHelper.visible = visible
    this.syncOverlayButtons()
  }

  isWireframe(): boolean {
    return this.wireframeEnabled
  }

  isGridVisible(): boolean {
    return this.gridVisible
  }

  private syncOverlayButtons(): void {
    const bar = this.container.querySelector('.view3d-toolbar')
    if (!bar) return
    const sync = (action: string, on: boolean) => {
      const row = bar.querySelector(`[data-action="${action}"]`) as HTMLElement | null
      if (!row) return
      row.classList.toggle('is-on', on)
      const track = row.querySelector('.view3d-switch-track') as HTMLElement | null
      track?.setAttribute('aria-checked', on ? 'true' : 'false')
    }
    sync('wireframe', this.wireframeEnabled)
    sync('grid', this.gridVisible)
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.container.querySelector('.view3d-toolbar')?.remove()
    this.loadingEl?.remove()
  }
}
