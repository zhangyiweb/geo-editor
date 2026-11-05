import type { BBox } from './bbox'
import { clampLat, normalizeBBox } from './bbox'

const TILE_SIZE = 256

export type TileCoord = { z: number; x: number; y: number }

export function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * Math.pow(2, z)
}

export function latToTileY(lat: number, z: number): number {
  const latRad = (clampLat(lat) * Math.PI) / 180
  return (
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    Math.pow(2, z)
  )
}

export function tileXToLng(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z)
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

export function bboxToTileRange(bbox: BBox, z: number): {
  minX: number
  maxX: number
  minY: number
  maxY: number
} {
  const b = normalizeBBox(bbox)
  const maxIndex = Math.pow(2, z) - 1
  const minX = Math.max(0, Math.floor(lngToTileX(b.west, z)))
  const maxX = Math.min(maxIndex, Math.floor(lngToTileX(b.east, z)))
  const minY = Math.max(0, Math.floor(latToTileY(b.north, z)))
  const maxY = Math.min(maxIndex, Math.floor(latToTileY(b.south, z)))
  return { minX, maxX, minY, maxY }
}

export function countTiles(bbox: BBox, z: number): number {
  const r = bboxToTileRange(bbox, z)
  return (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1)
}

export function listTiles(bbox: BBox, z: number): TileCoord[] {
  const r = bboxToTileRange(bbox, z)
  const tiles: TileCoord[] = []
  for (let y = r.minY; y <= r.maxY; y++) {
    for (let x = r.minX; x <= r.maxX; x++) {
      tiles.push({ z, x, y })
    }
  }
  return tiles
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load tile: ${url}`))
    img.src = url
  })
}

export type ProgressFn = (done: number, total: number) => void

export async function fetchTilesParallel(
  urls: string[],
  concurrency = 8,
  onProgress?: ProgressFn,
): Promise<(HTMLImageElement | null)[]> {
  const results: (HTMLImageElement | null)[] = new Array(urls.length).fill(null)
  let done = 0
  let index = 0

  async function worker() {
    while (index < urls.length) {
      const i = index++
      try {
        results[i] = await loadImage(urls[i]!)
      } catch {
        results[i] = null
      }
      done++
      onProgress?.(done, urls.length)
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, urls.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}

/**
 * Stitch XYZ tiles covering `bbox` into a canvas.
 * Pixel space maps linearly in Web Mercator tile space for the bbox.
 */
export async function stitchTilesToCanvas(
  bbox: BBox,
  z: number,
  urlForTile: (z: number, x: number, y: number) => string,
  options?: {
    maxSize?: number
    onProgress?: ProgressFn
  },
): Promise<HTMLCanvasElement> {
  const b = normalizeBBox(bbox)
  const range = bboxToTileRange(b, z)
  const tiles = listTiles(b, z)
  const urls = tiles.map((t) => urlForTile(t.z, t.x, t.y))
  const images = await fetchTilesParallel(urls, 8, options?.onProgress)

  const westX = lngToTileX(b.west, z)
  const eastX = lngToTileX(b.east, z)
  const northY = latToTileY(b.north, z)
  const southY = latToTileY(b.south, z)

  const widthPx = (eastX - westX) * TILE_SIZE
  const heightPx = (southY - northY) * TILE_SIZE

  const maxSize = options?.maxSize ?? 4096
  const scale = Math.min(1, maxSize / Math.max(widthPx, heightPx))
  const outW = Math.max(1, Math.round(widthPx * scale))
  const outH = Math.max(1, Math.round(heightPx * scale))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(0, 0, outW, outH)

  // 瓦片略微重叠 1px，避免浮点缩放后出现细缝网格线
  const overlap = 1
  tiles.forEach((tile, i) => {
    const img = images[i]
    if (!img) return
    const dx = Math.floor((tile.x - westX) * TILE_SIZE * scale) - overlap
    const dy = Math.floor((tile.y - northY) * TILE_SIZE * scale) - overlap
    const dw = Math.ceil(TILE_SIZE * scale) + overlap * 2
    const dh = Math.ceil(TILE_SIZE * scale) + overlap * 2
    ctx.drawImage(img, dx, dy, dw, dh)
  })

  void range
  return canvas
}

export { TILE_SIZE }
