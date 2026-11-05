import type { Mesh } from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'

export async function exportGLB(mesh: Mesh): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter()
  const result = await exporter.parseAsync(mesh, {
    binary: true,
    onlyVisible: true,
  })
  if (result instanceof ArrayBuffer) return result
  // JSON fallback — shouldn't happen with binary:true
  const json = JSON.stringify(result)
  return new TextEncoder().encode(json).buffer
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
