import type { Mesh } from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { formatBytes, prepareExportMesh } from './optimizeExport'

export async function exportGLB(mesh: Mesh): Promise<ArrayBuffer> {
  const prepared = await prepareExportMesh(mesh)
  try {
    const exporter = new GLTFExporter()
    const result = await exporter.parseAsync(prepared.mesh, {
      binary: true,
      onlyVisible: true,
    })
    if (result instanceof ArrayBuffer) return result
    const json = JSON.stringify(result)
    return new TextEncoder().encode(json).buffer
  } finally {
    prepared.dispose()
  }
}

export function downloadArrayBuffer(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], { type: 'application/octet-stream' })
  downloadBlob(blob, filename)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export { formatBytes }
