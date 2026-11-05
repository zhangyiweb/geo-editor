import * as THREE from 'three'
import type { BBox, SelectionShape } from '../geo/bbox'
import { normalizeBBox } from '../geo/bbox'
import type { HeightGrid } from '../geo/dem'

const METERS_PER_DEG_LAT = 111_320

export type TerrainMeshResult = {
  mesh: THREE.Mesh
  widthMeters: number
  heightMeters: number
  minElev: number
  maxElev: number
}

/**
 * Build a terrain mesh in local meters centered at origin.
 * X = east, Z = south (Three.js Y-up), so north is -Z.
 */
export function buildTerrainMesh(
  grid: HeightGrid,
  verticalExaggeration = 1,
  shape: SelectionShape = 'rect',
): TerrainMeshResult {
  const bbox = normalizeBBox(grid.bbox)
  const midLat = ((bbox.south + bbox.north) / 2) * (Math.PI / 180)
  const mPerDegLng = METERS_PER_DEG_LAT * Math.cos(midLat)
  const widthMeters = (bbox.east - bbox.west) * mPerDegLng
  const heightMeters = (bbox.north - bbox.south) * METERS_PER_DEG_LAT

  const { width: segX, height: segY, data, min, max } = grid
  const geo = new THREE.PlaneGeometry(
    widthMeters,
    heightMeters,
    segX - 1,
    segY - 1,
  )
  // PlaneGeometry is XY; rotate to XZ (Y up)
  geo.rotateX(-Math.PI / 2)

  const pos = geo.attributes.position as THREE.BufferAttribute
  // 最低点贴齐水平网格面（Y=0），避免地形沉到网格下方
  for (let j = 0; j < segY; j++) {
    for (let i = 0; i < segX; i++) {
      const elev = data[j * segX + i]!
      const idx = j * segX + i
      const y = (elev - min) * verticalExaggeration
      pos.setY(idx, y)
    }
  }

  const uv = geo.attributes.uv as THREE.BufferAttribute
  for (let j = 0; j < segY; j++) {
    for (let i = 0; i < segX; i++) {
      const idx = j * segX + i
      uv.setXY(idx, i / (segX - 1), 1 - j / (segY - 1))
    }
  }

  pos.needsUpdate = true
  uv.needsUpdate = true

  if (shape === 'circle') {
    clipGeometryToEllipse(geo, widthMeters / 2, heightMeters / 2)
  }

  geo.computeVertexNormals()

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide,
  })

  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'terrain'
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.shape = shape

  return {
    mesh,
    widthMeters,
    heightMeters,
    minElev: min,
    maxElev: max,
  }
}

/** Keep triangles whose centroid lies inside the ellipse x²/rx² + z²/rz² ≤ 1. */
function clipGeometryToEllipse(
  geo: THREE.BufferGeometry,
  radiusX: number,
  radiusZ: number,
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const index = geo.getIndex()
  if (!index) return

  const rx2 = Math.max(1e-6, radiusX * radiusX)
  const rz2 = Math.max(1e-6, radiusZ * radiusZ)
  const inside = new Uint8Array(pos.count)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    inside[i] = x * x / rx2 + z * z / rz2 <= 1.02 ? 1 : 0
  }

  const next: number[] = []
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t)
    const b = index.getX(t + 1)
    const c = index.getX(t + 2)
    const votes = inside[a]! + inside[b]! + inside[c]!
    if (votes === 0) continue
    // 至少两点在圆内，或重心在圆内，边缘更圆滑
    if (votes >= 2) {
      next.push(a, b, c)
      continue
    }
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3
    const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3
    if (cx * cx / rx2 + cz * cz / rz2 <= 1) next.push(a, b, c)
  }

  geo.setIndex(next)
  compactIndexedGeometry(geo)
  geo.computeBoundingSphere()
  geo.computeBoundingBox()
}

/** Remove vertices not used by the index — no precision loss on kept verts. */
function compactIndexedGeometry(geo: THREE.BufferGeometry): void {
  const index = geo.getIndex()
  if (!index || index.count === 0) return
  const vertCount = geo.attributes.position?.count ?? 0
  if (vertCount === 0) return

  const used = new Int32Array(vertCount).fill(-1)
  let nextId = 0
  const newIndex = new Uint32Array(index.count)
  for (let i = 0; i < index.count; i++) {
    const old = index.getX(i)
    let mapped = used[old]!
    if (mapped < 0) {
      mapped = nextId++
      used[old] = mapped
    }
    newIndex[i] = mapped
  }
  if (nextId === vertCount) return

  for (const name of Object.keys(geo.attributes)) {
    const attr = geo.attributes[name] as THREE.BufferAttribute
    const itemSize = attr.itemSize
    const ArrayCtor = attr.array.constructor as new (length: number) => Float32Array
    const dst = new ArrayCtor(nextId * itemSize)
    const src = attr.array
    for (let old = 0; old < vertCount; old++) {
      const n = used[old]!
      if (n < 0) continue
      for (let k = 0; k < itemSize; k++) {
        dst[n * itemSize + k] = src[old * itemSize + k]!
      }
    }
    geo.setAttribute(
      name,
      new THREE.BufferAttribute(dst, itemSize, attr.normalized),
    )
  }
  geo.setIndex(new THREE.BufferAttribute(newIndex, 1))
}

export function applyVerticalExaggeration(
  mesh: THREE.Mesh,
  grid: HeightGrid,
  verticalExaggeration: number,
): void {
  const geo = mesh.geometry as THREE.BufferGeometry
  const pos = geo.attributes.position as THREE.BufferAttribute
  const { width: segX, height: segY, data, min } = grid

  for (let j = 0; j < segY; j++) {
    for (let i = 0; i < segX; i++) {
      const elev = data[j * segX + i]!
      const idx = j * segX + i
      pos.setY(idx, (elev - min) * verticalExaggeration)
    }
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
}

export function applyTexture(
  mesh: THREE.Mesh,
  canvas: HTMLCanvasElement,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  // 避免 mipmap 采样在拼接缝处采到透明/背景色
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true

  const mat = mesh.material as THREE.MeshStandardMaterial
  if (mat.map) mat.map.dispose()
  mat.map = tex
  // 圆形选区贴图带透明边，需要开启透明
  const isCircle = mesh.userData.shape === 'circle'
  mat.transparent = isCircle
  mat.alphaTest = isCircle ? 0.08 : 0
  mat.needsUpdate = true
  return tex
}

export function disposeTerrain(mesh: THREE.Mesh | null): void {
  if (!mesh) return
  mesh.geometry.dispose()
  const mat = mesh.material as THREE.MeshStandardMaterial
  mat.map?.dispose()
  mat.dispose()
}

export type { BBox }
