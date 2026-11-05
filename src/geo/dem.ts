import type { BBox } from './bbox'
import { normalizeBBox } from './bbox'
import {
  latToTileY,
  lngToTileX,
  listTiles,
  loadImage,
  type ProgressFn,
  TILE_SIZE,
} from './tiles'

/** Terrarium encoding: elevation = R*256 + G + B/256 - 32768 */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768
}

export type HeightGrid = {
  width: number
  height: number
  /** Row-major, north→south, west→east */
  data: Float32Array
  min: number
  max: number
  bbox: BBox
}

type TilePixels = {
  z: number
  x: number
  y: number
  data: Uint8ClampedArray
}

function terrariumUrl(z: number, x: number, y: number): string {
  return `/proxy/terrarium/${z}/${x}/${y}.png`
}

/**
 * Sample DEM into a regular lat/lng grid covering bbox.
 * `samplesX/Y` are vertex counts along each edge.
 */
export async function fetchHeightGrid(
  bbox: BBox,
  zoom: number,
  samplesX: number,
  samplesY: number,
  onProgress?: ProgressFn,
): Promise<HeightGrid> {
  const b = normalizeBBox(bbox)
  const tiles = listTiles(b, zoom)
  const tilePixels: TilePixels[] = []

  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]!
    try {
      const img = await loadImage(terrariumUrl(t.z, t.x, t.y))
      const c = document.createElement('canvas')
      c.width = TILE_SIZE
      c.height = TILE_SIZE
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE)
      tilePixels.push({ z: t.z, x: t.x, y: t.y, data: imageData.data })
    } catch {
      // missing tile → sea level later
    }
    onProgress?.(i + 1, tiles.length)
  }

  const lookup = new Map<string, TilePixels>()
  for (const tp of tilePixels) {
    lookup.set(`${tp.z}/${tp.x}/${tp.y}`, tp)
  }

  const data = new Float32Array(samplesX * samplesY)
  let min = Infinity
  let max = -Infinity

  for (let j = 0; j < samplesY; j++) {
    const lat = b.north - (j / Math.max(1, samplesY - 1)) * (b.north - b.south)
    for (let i = 0; i < samplesX; i++) {
      const lng = b.west + (i / Math.max(1, samplesX - 1)) * (b.east - b.west)
      const elev = sampleElevation(lng, lat, zoom, lookup)
      data[j * samplesX + i] = elev
      if (elev < min) min = elev
      if (elev > max) max = elev
    }
  }

  if (!Number.isFinite(min)) {
    min = 0
    max = 0
  }

  return { width: samplesX, height: samplesY, data, min, max, bbox: b }
}

function sampleElevation(
  lng: number,
  lat: number,
  z: number,
  lookup: Map<string, TilePixels>,
): number {
  const fx = lngToTileX(lng, z)
  const fy = latToTileY(lat, z)
  const tx = Math.floor(fx)
  const ty = Math.floor(fy)
  const tile = lookup.get(`${z}/${tx}/${ty}`)
  if (!tile) return 0
  const px = Math.min(
    TILE_SIZE - 1,
    Math.max(0, Math.floor((fx - tx) * TILE_SIZE)),
  )
  const py = Math.min(
    TILE_SIZE - 1,
    Math.max(0, Math.floor((fy - ty) * TILE_SIZE)),
  )
  const idx = (py * TILE_SIZE + px) * 4
  const r = tile.data[idx]!
  const g = tile.data[idx + 1]!
  const b = tile.data[idx + 2]!
  return decodeTerrarium(r, g, b)
}

/** Estimate grid resolution from DEM zoom and bbox, capped. */
export function resolveSampleSize(
  bbox: BBox,
  demZoom: number,
  maxEdge = 512,
): { samplesX: number; samplesY: number } {
  const b = normalizeBBox(bbox)
  const westX = lngToTileX(b.west, demZoom)
  const eastX = lngToTileX(b.east, demZoom)
  const northY = latToTileY(b.north, demZoom)
  const southY = latToTileY(b.south, demZoom)
  const pxW = Math.abs(eastX - westX) * TILE_SIZE
  const pxH = Math.abs(southY - northY) * TILE_SIZE
  let samplesX = Math.max(2, Math.round(pxW / 2))
  let samplesY = Math.max(2, Math.round(pxH / 2))
  const scale = Math.min(1, maxEdge / Math.max(samplesX, samplesY))
  samplesX = Math.max(2, Math.round(samplesX * scale))
  samplesY = Math.max(2, Math.round(samplesY * scale))
  return { samplesX, samplesY }
}
