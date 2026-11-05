import { zipSync, strToU8 } from 'fflate'
import type { Mesh } from 'three'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import { downloadBlob } from './exportGLTF'
import { exportMTLText, exportOBJText, getMeshDiffuseCanvas } from './exportOBJ'
import { canvasToBlob } from '../terrain/TextureAtlas'

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer()
  return new Uint8Array(buf)
}

export async function exportObjZip(mesh: Mesh, basename = 'terrain'): Promise<void> {
  const obj = exportOBJText(mesh)
  const mtl = exportMTLText()
  const files: Record<string, Uint8Array> = {
    [`${basename}.obj`]: strToU8(obj),
    [`${basename}.mtl`]: strToU8(mtl),
  }

  const canvas = getMeshDiffuseCanvas(mesh)
  if (canvas) {
    const pngBlob = await canvasToBlob(canvas, 'image/png')
    const pngBytes = await blobToUint8Array(pngBlob)
    files[`${basename}_diffuse.png`] = pngBytes
    files['terrain_diffuse.png'] = pngBytes
  }

  const zipped = zipSync(files, { level: 6 })
  downloadBlob(new Blob([zipped], { type: 'application/zip' }), `${basename}_obj.zip`)
}

export function exportSTL(mesh: Mesh, basename = 'terrain'): void {
  const exporter = new STLExporter()
  const result = exporter.parse(mesh, { binary: true })
  const blob =
    result instanceof DataView
      ? new Blob([result], { type: 'application/octet-stream' })
      : new Blob([result], { type: 'application/octet-stream' })
  downloadBlob(blob, `${basename}.stl`)
}

export async function exportTexturePng(
  mesh: Mesh,
  basename = 'terrain_diffuse',
): Promise<void> {
  const canvas = getMeshDiffuseCanvas(mesh)
  if (!canvas) throw new Error('当前模型没有贴图')
  const blob = await canvasToBlob(canvas, 'image/png')
  downloadBlob(blob, `${basename}.png`)
}
