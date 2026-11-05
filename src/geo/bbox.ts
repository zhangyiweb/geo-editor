export type BBox = {
  west: number
  south: number
  east: number
  north: number
}

export type SelectionShape = 'rect' | 'circle'

export type TexturePatch = {
  id: string
  bbox: BBox
  textureZoom: number
  shape?: SelectionShape
}

export function clampLat(lat: number): number {
  return Math.max(-85.05112878, Math.min(85.05112878, lat))
}

export function normalizeBBox(bbox: BBox): BBox {
  return {
    west: Math.min(bbox.west, bbox.east),
    east: Math.max(bbox.west, bbox.east),
    south: clampLat(Math.min(bbox.south, bbox.north)),
    north: clampLat(Math.max(bbox.south, bbox.north)),
  }
}

export function bboxAreaKm2(bbox: BBox): number {
  const b = normalizeBBox(bbox)
  const midLat = ((b.south + b.north) / 2) * (Math.PI / 180)
  const mPerDegLat = 111_320
  const mPerDegLng = 111_320 * Math.cos(midLat)
  const w = (b.east - b.west) * mPerDegLng
  const h = (b.north - b.south) * mPerDegLat
  return Math.abs((w * h) / 1_000_000)
}

export function bboxContains(outer: BBox, inner: BBox): boolean {
  const o = normalizeBBox(outer)
  const i = normalizeBBox(inner)
  return (
    i.west >= o.west &&
    i.east <= o.east &&
    i.south >= o.south &&
    i.north <= o.north
  )
}

export function bboxIntersect(a: BBox, b: BBox): BBox | null {
  const aa = normalizeBBox(a)
  const bb = normalizeBBox(b)
  const west = Math.max(aa.west, bb.west)
  const east = Math.min(aa.east, bb.east)
  const south = Math.max(aa.south, bb.south)
  const north = Math.min(aa.north, bb.north)
  if (west >= east || south >= north) return null
  return { west, south, east, north }
}

export function bboxCenter(bbox: BBox): { lng: number; lat: number } {
  const b = normalizeBBox(bbox)
  return {
    lng: (b.west + b.east) / 2,
    lat: (b.south + b.north) / 2,
  }
}

const M_PER_DEG_LAT = 111_320

/** Create a square bbox around center with approximate area in km². */
export function bboxFromAreaKm2(
  center: { lng: number; lat: number },
  areaKm2: number,
): BBox {
  const areaM2 = Math.max(0.01, areaKm2) * 1_000_000
  const sideM = Math.sqrt(areaM2)
  return bboxFromHalfMeters(center, sideM / 2, sideM / 2)
}

/** Create bbox covering a circle of given area (km²) around center. */
export function bboxFromCircleAreaKm2(
  center: { lng: number; lat: number },
  areaKm2: number,
): BBox {
  const areaM2 = Math.max(0.01, areaKm2) * 1_000_000
  const radiusM = Math.sqrt(areaM2 / Math.PI)
  return bboxFromHalfMeters(center, radiusM, radiusM)
}

function bboxFromHalfMeters(
  center: { lng: number; lat: number },
  halfNorthM: number,
  halfEastM: number,
): BBox {
  const latRad = (center.lat * Math.PI) / 180
  const mPerDegLng = M_PER_DEG_LAT * Math.max(0.05, Math.cos(latRad))
  const halfLat = halfNorthM / M_PER_DEG_LAT
  const halfLng = halfEastM / mPerDegLng
  return normalizeBBox({
    west: center.lng - halfLng,
    east: center.lng + halfLng,
    south: center.lat - halfLat,
    north: center.lat + halfLat,
  })
}

/**
 * Scale bbox about its center to match target area, keeping aspect ratio.
 * If current area is ~0, falls back to a square at the center.
 */
export function scaleBBoxToAreaKm2(bbox: BBox, areaKm2: number): BBox {
  const b = normalizeBBox(bbox)
  const current = bboxAreaKm2(b)
  const center = bboxCenter(b)
  if (current < 1e-8) return bboxFromAreaKm2(center, areaKm2)
  const scale = Math.sqrt(Math.max(0.01, areaKm2) / current)
  const halfLng = ((b.east - b.west) / 2) * scale
  const halfLat = ((b.north - b.south) / 2) * scale
  return normalizeBBox({
    west: center.lng - halfLng,
    east: center.lng + halfLng,
    south: center.lat - halfLat,
    north: center.lat + halfLat,
  })
}

/** Map lon/lat within main bbox to UV [0,1] */
export function lonLatToUv(
  lng: number,
  lat: number,
  bbox: BBox,
): { u: number; v: number } {
  const b = normalizeBBox(bbox)
  return {
    u: (lng - b.west) / (b.east - b.west),
    v: (lat - b.south) / (b.north - b.south),
  }
}

export function formatBBox(bbox: BBox): string {
  const b = normalizeBBox(bbox)
  return `${b.west.toFixed(5)}, ${b.south.toFixed(5)} → ${b.east.toFixed(5)}, ${b.north.toFixed(5)}`
}
