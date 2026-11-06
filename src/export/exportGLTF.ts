import * as THREE from 'three'
import type { Mesh, MeshStandardMaterial } from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import {
  compactIndexedGeometry,
  formatBytes,
  prepareExportMesh,
} from './optimizeExport'

/** GLB 一体：网格 + 贴图（JPEG 嵌入） */
export async function exportGLB(mesh: Mesh): Promise<ArrayBuffer> {
  const prepared = await prepareExportMesh(mesh)
  try {
    return await parseGlb(prepared.mesh)
  } finally {
    prepared.dispose()
  }
}

/**
 * 仅几何 GLB：保留 position / normal / uv，无贴图。
 * 分包时由外部 KTX2/JPG 赋材质。
 */
export async function exportGeometryGLB(mesh: Mesh): Promise<ArrayBuffer> {
  const geo = mesh.geometry.clone()
  // 编辑器内部属性，勿写入 GLB
  geo.deleteAttribute('elevation')
  compactIndexedGeometry(geo)
  const srcMat = mesh.material as MeshStandardMaterial
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: srcMat.roughness ?? 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  const clone = new THREE.Mesh(geo, mat)
  clone.name = mesh.name || 'terrain'
  try {
    return await parseGlb(clone)
  } finally {
    geo.dispose()
    mat.dispose()
  }
}

async function parseGlb(mesh: Mesh): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter()
  const result = await exporter.parseAsync(mesh, {
    binary: true,
    onlyVisible: true,
  })
  if (result instanceof ArrayBuffer) return result
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

export function downloadText(
  text: string,
  filename: string,
  mime = 'application/json',
): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename)
}

export { formatBytes }
