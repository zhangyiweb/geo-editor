import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Mesh, MeshStandardMaterial } from 'three'
import { applyTexture } from '../terrain/TerrainBuilder'
import {
  downloadArrayBuffer,
  downloadBlob,
  exportGLB,
} from '../export/exportGLTF'
import { canvasToKtx2 } from '../export/encodeKtx2'
import { canvasToBlob } from '../terrain/TextureAtlas'
import { EXPORT_JPEG_QUALITY, formatBytes } from '../export/optimizeExport'
import {
  VIEWER_DIFFUSE_KTX2_NAME,
  VIEWER_GLB_NAME,
  VIEWER_MODEL_BASENAME,
} from '../export/assetNames'

export type TextureStudioCallbacks = {
  /** 把当前贴图画布应用到主场景地形 */
  onApplyToScene: (canvas: HTMLCanvasElement) => void
  onStatus?: (text: string) => void
}

/**
 * 贴图精修弹窗：固定使用当前地形网格，上传 JPG/PNG 预览，
 * 可应用到场景或导出 GLB / KTX2 / JPG。
 */
export class TextureStudio {
  private readonly dialog: HTMLDialogElement
  private readonly viewport: HTMLElement
  private readonly fileInput: HTMLInputElement
  private readonly statusEl: HTMLElement
  private readonly btnApply: HTMLButtonElement
  private readonly btnGlb: HTMLButtonElement
  private readonly btnKtx2: HTMLButtonElement
  private readonly btnJpg: HTMLButtonElement
  private readonly callbacks: TextureStudioCallbacks

  private renderer: THREE.WebGLRenderer | null = null
  private camera: THREE.PerspectiveCamera | null = null
  private controls: OrbitControls | null = null
  private previewMesh: THREE.Mesh | null = null
  private raf = 0
  private resizeObs: ResizeObserver | null = null
  private textureCanvas: HTMLCanvasElement | null = null
  private objectUrl: string | null = null

  constructor(dialog: HTMLDialogElement, callbacks: TextureStudioCallbacks) {
    this.dialog = dialog
    this.callbacks = callbacks
    this.viewport = dialog.querySelector('#tex-studio-view') as HTMLElement
    this.fileInput = dialog.querySelector('#tex-studio-file') as HTMLInputElement
    this.statusEl = dialog.querySelector('#tex-studio-status') as HTMLElement
    this.btnApply = dialog.querySelector('#tex-studio-apply') as HTMLButtonElement
    this.btnGlb = dialog.querySelector('#tex-studio-glb') as HTMLButtonElement
    this.btnKtx2 = dialog.querySelector('#tex-studio-ktx2') as HTMLButtonElement
    this.btnJpg = dialog.querySelector('#tex-studio-jpg') as HTMLButtonElement

    dialog.querySelector('#tex-studio-upload')?.addEventListener('click', () => {
      this.fileInput.click()
    })
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0]
      this.fileInput.value = ''
      if (file) void this.loadTextureFile(file)
    })
    this.btnApply.addEventListener('click', () => this.applyToScene())
    this.btnGlb.addEventListener('click', () => void this.exportGlb())
    this.btnKtx2.addEventListener('click', () => void this.exportKtx2())
    this.btnJpg.addEventListener('click', () => void this.exportJpg())

    dialog.addEventListener('click', (ev) => {
      if (ev.target === dialog) dialog.close()
    })
    dialog.addEventListener('close', () => this.teardownPreview())
  }

  open(sourceMesh: Mesh): void {
    this.textureCanvas = null
    this.setStatus('可上传 PS 修好的 JPG/PNG 预览；满意后应用到场景或导出。')
    this.syncActionButtons(false)
    this.dialog.showModal()
    requestAnimationFrame(() => {
      this.setupPreview(sourceMesh)
    })
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text
    this.callbacks.onStatus?.(text)
  }

  private syncActionButtons(hasCustomTex: boolean): void {
    this.btnApply.disabled = !hasCustomTex
    this.btnGlb.disabled = !hasCustomTex
    this.btnKtx2.disabled = !hasCustomTex
    this.btnJpg.disabled = !hasCustomTex
  }

  private setupPreview(source: Mesh): void {
    this.teardownPreview()

    const w = Math.max(320, this.viewport.clientWidth || 640)
    const h = Math.max(240, this.viewport.clientHeight || 420)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(w, h)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    this.viewport.replaceChildren(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0b1220)
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 1e6)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    scene.add(new THREE.AmbientLight(0xffffff, 0.4))
    const sun = new THREE.DirectionalLight(0xffffff, 8)
    scene.add(sun)

    const geo = source.geometry.clone()
    const srcMat = source.material as MeshStandardMaterial
    // 克隆贴图，避免预览替换时 dispose 掉主场景材质
    const mapClone = srcMat.map ? srcMat.map.clone() : null
    if (mapClone) mapClone.needsUpdate = true
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: mapClone,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: source.userData.shape === 'circle',
      alphaTest: source.userData.shape === 'circle' ? 0.08 : 0,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = 'terrain-preview'
    mesh.userData.shape = source.userData.shape
    scene.add(mesh)

    const box = new THREE.Box3().setFromObject(mesh)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    controls.target.copy(center)
    const r = Math.max(size.x, size.y, size.z, 1)
    sun.target.position.copy(center)
    sun.position.set(center.x + r, center.y + r * 1.5, center.z + r * 0.5)
    scene.add(sun.target)
    camera.position.set(center.x + r * 0.6, center.y + r * 0.7, center.z + r * 0.8)
    camera.near = Math.max(0.1, r / 1000)
    camera.far = r * 40
    camera.updateProjectionMatrix()

    this.renderer = renderer
    this.camera = camera
    this.controls = controls
    this.previewMesh = mesh

    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(this.viewport)

    const loop = () => {
      this.raf = requestAnimationFrame(loop)
      controls.update()
      renderer.render(scene, camera)
    }
    loop()
  }

  private resize(): void {
    if (!this.renderer || !this.camera) return
    const w = Math.max(1, this.viewport.clientWidth)
    const h = Math.max(1, this.viewport.clientHeight)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  private teardownPreview(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.resizeObs?.disconnect()
    this.resizeObs = null
    this.controls?.dispose()
    this.controls = null
    if (this.previewMesh) {
      this.previewMesh.geometry.dispose()
      const mat = this.previewMesh.material as MeshStandardMaterial
      mat.map?.dispose()
      mat.dispose()
      this.previewMesh = null
    }
    this.renderer?.dispose()
    this.renderer?.domElement.remove()
    this.renderer = null
    this.camera = null
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
  }

  private async loadTextureFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      this.setStatus('请选择 JPG / PNG 图片')
      return
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    const url = URL.createObjectURL(file)
    this.objectUrl = url

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('图片加载失败'))
        el.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth || img.width
      canvas.height = img.naturalHeight || img.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      this.textureCanvas = canvas

      if (this.previewMesh) {
        applyTexture(this.previewMesh, canvas)
      }
      this.syncActionButtons(true)
      this.setStatus(
        `已加载 ${file.name}（${canvas.width}×${canvas.height}）· 可应用到场景或导出`,
      )
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : '贴图加载失败')
      this.syncActionButtons(false)
    }
  }

  private applyToScene(): void {
    if (!this.textureCanvas) return
    this.callbacks.onApplyToScene(this.textureCanvas)
    this.setStatus('已应用到主场景地形')
  }

  private async exportGlb(): Promise<void> {
    if (!this.previewMesh || !this.textureCanvas) return
    try {
      this.setStatus('导出一体 GLB…')
      const buf = await exportGLB(this.previewMesh)
      downloadArrayBuffer(buf, VIEWER_GLB_NAME)
      this.setStatus(`已下载 ${VIEWER_GLB_NAME}（${formatBytes(buf.byteLength)}）`)
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : 'GLB 导出失败')
    }
  }

  private async exportKtx2(): Promise<void> {
    if (!this.textureCanvas) return
    try {
      this.setStatus('编码 KTX2…')
      // 圆形透明边用 PNG；矩形走 KTX2（编码前对齐 4 的倍数）
      if (this.previewMesh?.userData.shape === 'circle') {
        const png = await canvasToBlob(this.textureCanvas, 'image/png')
        downloadBlob(png, `${VIEWER_MODEL_BASENAME}_diffuse.png`)
        this.setStatus(
          `圆形选区已导出 PNG（${formatBytes(png.size)}），KTX2 不适合透明边`,
        )
        return
      }
      const ktx2 = await canvasToKtx2(this.textureCanvas)
      const bytes = new Uint8Array(ktx2)
      downloadBlob(
        new Blob([bytes], { type: 'application/octet-stream' }),
        VIEWER_DIFFUSE_KTX2_NAME,
      )
      this.setStatus(
        `已下载 ${VIEWER_DIFFUSE_KTX2_NAME}（${formatBytes(bytes.byteLength)}）`,
      )
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : 'KTX2 导出失败')
    }
  }

  private async exportJpg(): Promise<void> {
    if (!this.textureCanvas) return
    try {
      const needsAlpha = this.previewMesh?.userData.shape === 'circle'
      const blob = needsAlpha
        ? await canvasToBlob(this.textureCanvas, 'image/png')
        : await canvasToBlob(
            this.textureCanvas,
            'image/jpeg',
            EXPORT_JPEG_QUALITY,
          )
      const name = `${VIEWER_MODEL_BASENAME}_diffuse.${needsAlpha ? 'png' : 'jpg'}`
      downloadBlob(blob, name)
      this.setStatus(`已下载 ${name}（${formatBytes(blob.size)}）`)
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : '图片导出失败')
    }
  }
}

export function textureStudioDialogHtml(): string {
  return `
    <dialog class="texture-studio-dialog" id="texture-studio-dialog">
      <div class="texture-studio-card">
        <header class="export-dialog-header">
          <h2>贴图精修</h2>
          <button type="button" class="export-dialog-close" id="tex-studio-close" aria-label="关闭">×</button>
        </header>
        <p class="export-dialog-hint">固定使用当前地形网格。导出 JPG → PS 修改 → 上传预览 → 应用到场景或导出 GLB / KTX2。</p>
        <div class="texture-studio-body">
          <aside class="texture-studio-side">
            <input id="tex-studio-file" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" hidden />
            <button type="button" class="btn primary block" id="tex-studio-upload">上传 JPG / PNG</button>
            <button type="button" class="btn block" id="tex-studio-apply" disabled>应用到场景</button>
            <button type="button" class="btn block" id="tex-studio-glb" disabled>导出 terrain.glb</button>
            <button type="button" class="btn block" id="tex-studio-ktx2" disabled>导出 KTX2</button>
            <button type="button" class="btn block" id="tex-studio-jpg" disabled>导出 JPG / PNG</button>
            <p class="texture-studio-status" id="tex-studio-status">请先生成地形后再打开</p>
          </aside>
          <div class="texture-studio-view" id="tex-studio-view"></div>
        </div>
      </div>
    </dialog>
  `
}
