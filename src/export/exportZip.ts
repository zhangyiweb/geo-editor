import { zipSync, strToU8 } from 'fflate'
import type { Mesh } from 'three'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import { downloadBlob } from './exportGLTF'
import { exportMTLText, exportOBJText, getMeshDiffuseCanvas } from './exportOBJ'
import { canvasToBlob } from '../terrain/TextureAtlas'
import {
  EXPORT_JPEG_QUALITY,
  compactIndexedGeometry,
  formatBytes,
  prepareExportMesh,
} from './optimizeExport'

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer()
  return new Uint8Array(buf)
}

export async function exportObjZip(mesh: Mesh, basename = 'terrain'): Promise<Blob> {
  const prepared = await prepareExportMesh(mesh)
  try {
    const obj = exportOBJText(prepared.mesh)
    const canvas = getMeshDiffuseCanvas(prepared.mesh)
    const useJpeg = prepared.textureAsJpeg && !!canvas
    const diffuseName = useJpeg
      ? `${basename}_diffuse.jpg`
      : `${basename}_diffuse.png`
    const mtl = exportMTLText(
      useJpeg ? 'terrain_diffuse.jpg' : 'terrain_diffuse.png',
    )

    const files: Record<string, Uint8Array> = {
      [`${basename}.obj`]: strToU8(obj),
      [`${basename}.mtl`]: strToU8(mtl),
    }

    if (canvas) {
      const blob = useJpeg
        ? await canvasToBlob(canvas, 'image/jpeg', EXPORT_JPEG_QUALITY)
        : await canvasToBlob(canvas, 'image/png')
      const bytes = await blobToUint8Array(blob)
      files[diffuseName] = bytes
      files[useJpeg ? 'terrain_diffuse.jpg' : 'terrain_diffuse.png'] = bytes
    }

    const zipped = zipSync(files, { level: 6 })
    const out = new Blob([zipped], { type: 'application/zip' })
    downloadBlob(out, `${basename}_obj.zip`)
    return out
  } finally {
    prepared.dispose()
  }
}

export function exportSTL(mesh: Mesh, basename = 'terrain'): Blob {
  const geo = mesh.geometry.clone()
  compactIndexedGeometry(geo)
  const temp = mesh.clone()
  temp.geometry = geo
  try {
    const exporter = new STLExporter()
    const result = exporter.parse(temp, { binary: true })
    const blob =
      result instanceof DataView
        ? new Blob([result], { type: 'application/octet-stream' })
        : new Blob([result], { type: 'application/octet-stream' })
    downloadBlob(blob, `${basename}.stl`)
    return blob
  } finally {
    geo.dispose()
  }
}

export async function exportTexturePng(
  mesh: Mesh,
  basename = 'terrain_diffuse',
): Promise<Blob> {
  const canvas = getMeshDiffuseCanvas(mesh)
  if (!canvas) throw new Error('当前模型没有贴图')
  const needsAlpha = mesh.userData.shape === 'circle'
  const blob = needsAlpha
    ? await canvasToBlob(canvas, 'image/png')
    : await canvasToBlob(canvas, 'image/jpeg', EXPORT_JPEG_QUALITY)
  const ext = needsAlpha ? 'png' : 'jpg'
  downloadBlob(blob, `${basename}.${ext}`)
  return blob
}

export { formatBytes }
