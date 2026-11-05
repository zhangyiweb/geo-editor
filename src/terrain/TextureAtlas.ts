import type { BBox, TexturePatch } from '../geo/bbox'
import { bboxIntersect, lonLatToUv, normalizeBBox } from '../geo/bbox'
import {
  getProvider,
  providerTileUrl,
  type ImageryProvider,
} from '../geo/providers'
import { stitchTilesToCanvas, type ProgressFn } from '../geo/tiles'

export type AtlasOptions = {
  providerId: string
  baseZoom: number
  patches?: TexturePatch[]
  maxSize?: number
  onProgress?: ProgressFn
  /** 主区域形状：圆形时对外围贴图做透明遮罩 */
  shape?: 'rect' | 'circle'
}

/**
 * Build a single diffuse atlas for the main bbox.
 * Patches with higher zoom overwrite corresponding pixel regions.
 */
export async function buildTextureAtlas(
  mainBBox: BBox,
  options: AtlasOptions,
): Promise<HTMLCanvasElement> {
  const bbox = normalizeBBox(mainBBox)
  const provider = getProvider(options.providerId)
  const maxSize = options.maxSize ?? 4096

  const base = await stitchTilesToCanvas(
    bbox,
    Math.min(options.baseZoom, provider.maxZoom),
    (z, x, y) => providerTileUrl(provider, z, x, y),
    { maxSize, onProgress: options.onProgress },
  )

  const patches = options.patches ?? []
  for (const patch of patches) {
    const clipped = bboxIntersect(bbox, patch.bbox)
    if (!clipped) continue
    const zoom = Math.min(patch.textureZoom, provider.maxZoom)
    await paintPatch(
      base,
      bbox,
      clipped,
      provider,
      zoom,
      patch.shape ?? 'rect',
      options.onProgress,
    )
  }

  if (options.shape === 'circle') {
    maskCanvasCircle(base)
  }

  return base
}

function maskCanvasCircle(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas
  ctx.save()
  ctx.globalCompositeOperation = 'destination-in'
  ctx.beginPath()
  ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

async function paintPatch(
  atlas: HTMLCanvasElement,
  mainBBox: BBox,
  patchBBox: BBox,
  provider: ImageryProvider,
  zoom: number,
  shape: 'rect' | 'circle',
  onProgress?: ProgressFn,
): Promise<void> {
  const patchCanvas = await stitchTilesToCanvas(
    patchBBox,
    zoom,
    (z, x, y) => providerTileUrl(provider, z, x, y),
    { maxSize: 4096, onProgress },
  )

  const sw = lonLatToUv(patchBBox.west, patchBBox.south, mainBBox)
  const ne = lonLatToUv(patchBBox.east, patchBBox.north, mainBBox)

  const dx = sw.u * atlas.width
  const dy = (1 - ne.v) * atlas.height
  const dw = (ne.u - sw.u) * atlas.width
  const dh = (ne.v - sw.v) * atlas.height

  const ctx = atlas.getContext('2d')!
  if (shape === 'circle') {
    ctx.save()
    ctx.beginPath()
    ctx.ellipse(dx + dw / 2, dy + dh / 2, dw / 2, dh / 2, 0, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(patchCanvas, dx, dy, dw, dh)
    ctx.restore()
  } else {
    ctx.drawImage(patchCanvas, dx, dy, dw, dh)
  }
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('canvas.toBlob failed'))
      },
      type,
      quality,
    )
  })
}
