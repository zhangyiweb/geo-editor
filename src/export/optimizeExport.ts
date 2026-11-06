import * as THREE from 'three'
import type { Mesh, MeshStandardMaterial } from 'three'
import { canvasToBlob } from '../terrain/TextureAtlas'

/** JPEG quality for satellite diffuse — visual loss is tiny vs PNG, size drops a lot. */
export const EXPORT_JPEG_QUALITY = 0.86

/**
 * Drop vertices not referenced by the index (e.g. after circular clip).
 * Does not change remaining vertex positions / UVs / normals.
 */
export function compactIndexedGeometry(geo: THREE.BufferGeometry): void {
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
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
}

/** Encode canvas as JPEG then decode back — shrinks GLB/OBJ texture payload. */
async function bakeJpegImage(
  source: HTMLCanvasElement | OffscreenCanvas | ImageBitmap | HTMLImageElement,
  quality: number,
): Promise<HTMLCanvasElement> {
  const w =
    'width' in source ? Number(source.width) : (source as HTMLImageElement).naturalWidth
  const h =
    'height' in source
      ? Number(source.height)
      : (source as HTMLImageElement).naturalHeight
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  tmp.getContext('2d')!.drawImage(source as CanvasImageSource, 0, 0)
  const blob = await canvasToBlob(tmp, 'image/jpeg', quality)
  const bitmap = await createImageBitmap(blob)
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  out.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  return out
}

export type PreparedExport = {
  mesh: Mesh
  dispose: () => void
  textureAsJpeg: boolean
}

/**
 * Clone mesh for export: compact geometry + JPEG diffuse when opaque
 * (circle keeps PNG for alpha).
 */
export async function prepareExportMesh(source: Mesh): Promise<PreparedExport> {
  const geo = source.geometry.clone()
  geo.deleteAttribute('elevation')
  compactIndexedGeometry(geo)

  const srcMat = source.material as MeshStandardMaterial
  const mat = srcMat.clone()
  const disposables: { dispose: () => void }[] = [geo, mat]

  let textureAsJpeg = false
  const needsAlpha =
    source.userData.shape === 'circle' || srcMat.transparent === true

  if (srcMat.map) {
    const map = srcMat.map.clone()
    map.colorSpace = srcMat.map.colorSpace
    map.wrapS = srcMat.map.wrapS
    map.wrapT = srcMat.map.wrapT
    map.flipY = srcMat.map.flipY

    const img = srcMat.map.image as
      | HTMLCanvasElement
      | OffscreenCanvas
      | ImageBitmap
      | HTMLImageElement
      | undefined

    if (img && !needsAlpha) {
      map.image = await bakeJpegImage(img, EXPORT_JPEG_QUALITY)
      map.userData.mimeType = 'image/jpeg'
      textureAsJpeg = true
    } else {
      map.userData.mimeType = 'image/png'
    }
    map.needsUpdate = true
    mat.map = map
    disposables.push(map)
  }

  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = source.name || 'terrain'
  mesh.userData = { ...source.userData }

  return {
    mesh,
    textureAsJpeg,
    dispose: () => {
      for (const d of disposables) d.dispose()
    },
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
