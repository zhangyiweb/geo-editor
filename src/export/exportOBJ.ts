import type { Mesh, MeshStandardMaterial } from 'three'
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js'

export function exportOBJText(mesh: Mesh): string {
  const exporter = new OBJExporter()
  // OBJExporter doesn't write MTL references by default for materials with maps.
  // We produce OBJ + companion MTL ourselves.
  const raw = exporter.parse(mesh)
  // Ensure mtllib / usemtl lines
  let obj = raw
  if (!obj.includes('mtllib')) {
    obj = `mtllib terrain.mtl\nusemtl terrain\n` + obj
  }
  return obj
}

export function exportMTLText(): string {
  return [
    'newmtl terrain',
    'Ka 1.000 1.000 1.000',
    'Kd 1.000 1.000 1.000',
    'Ks 0.050 0.050 0.050',
    'd 1.0',
    'illum 2',
    'map_Kd terrain_diffuse.png',
    '',
  ].join('\n')
}

export function getMeshDiffuseCanvas(mesh: Mesh): HTMLCanvasElement | null {
  const mat = mesh.material as MeshStandardMaterial
  const map = mat.map
  if (!map) return null
  const img = map.image as
    | HTMLCanvasElement
    | HTMLImageElement
    | ImageBitmap
    | undefined
  if (!img) return null
  if (img instanceof HTMLCanvasElement) return img
  const c = document.createElement('canvas')
  const w = 'width' in img ? Number(img.width) : 1024
  const h = 'height' in img ? Number(img.height) : 1024
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.drawImage(img as CanvasImageSource, 0, 0)
  return c
}
