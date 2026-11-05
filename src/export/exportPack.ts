import { zipSync, strToU8 } from 'fflate'
import type { Mesh } from 'three'
import { downloadBlob, exportGeometryGLB } from './exportGLTF'
import { getMeshDiffuseCanvas } from './exportOBJ'
import { canvasToKtx2 } from './encodeKtx2'
import { canvasToBlob } from '../terrain/TextureAtlas'
import { EXPORT_JPEG_QUALITY, formatBytes } from './optimizeExport'

const LOAD_HINT = `Three.js 加载示例（几何 GLB + KTX2 贴图）
========================================
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'

const renderer = new THREE.WebGLRenderer()
const ktx2 = new KTX2Loader()
  .setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/libs/basis/')
  .detectSupport(renderer)

const gltf = await new GLTFLoader().loadAsync('20261105_171530.glb')
const mesh = gltf.scene.children[0]
const map = await ktx2.loadAsync('20261105_171530_diffuse.ktx2')
map.colorSpace = THREE.SRGBColorSpace
mesh.material = new THREE.MeshStandardMaterial({ map, roughness: 0.95 })
scene.add(gltf.scene)

说明：KTX2（ETC1S）通常比同分辨率 JPG 更小，且 GPU 直传更快。
文件名以导出时的本地时间戳为准（如 20261105_171530.glb）。
若编码失败，包内会回退为 *_diffuse.jpg。
`

export type TerrainPackResult = {
  blob: Blob
  textureFormat: 'ktx2' | 'jpg' | 'png' | 'none'
  geometryBytes: number
  textureBytes: number
}

/** 网格+贴图分包：{stamp}.glb（无贴图）+ {stamp}_diffuse.ktx2（失败则 jpg/png） */
export async function exportTerrainPack(
  mesh: Mesh,
  basename: string,
): Promise<TerrainPackResult> {
  const glb = await exportGeometryGLB(mesh)
  const glbBytes = new Uint8Array(glb)

  const files: Record<string, Uint8Array> = {
    [`${basename}.glb`]: glbBytes,
    'README_加载说明.txt': strToU8(LOAD_HINT),
  }

  let textureFormat: TerrainPackResult['textureFormat'] = 'none'
  let textureBytes = 0
  const canvas = getMeshDiffuseCanvas(mesh)

  if (canvas) {
    const needsAlpha = mesh.userData.shape === 'circle'
    try {
      if (needsAlpha) {
        // KTX2 ETC1S 对透明圆边不够友好，圆形保留 PNG
        const png = await canvasToBlob(canvas, 'image/png')
        const bytes = new Uint8Array(await png.arrayBuffer())
        files[`${basename}_diffuse.png`] = bytes
        textureFormat = 'png'
        textureBytes = bytes.byteLength
      } else {
        const ktx2 = await canvasToKtx2(canvas)
        files[`${basename}_diffuse.ktx2`] = ktx2
        textureFormat = 'ktx2'
        textureBytes = ktx2.byteLength
      }
    } catch (err) {
      console.warn('KTX2 encode failed, fallback to JPEG/PNG', err)
      const blob = needsAlpha
        ? await canvasToBlob(canvas, 'image/png')
        : await canvasToBlob(canvas, 'image/jpeg', EXPORT_JPEG_QUALITY)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const ext = needsAlpha ? 'png' : 'jpg'
      files[`${basename}_diffuse.${ext}`] = bytes
      textureFormat = ext
      textureBytes = bytes.byteLength
    }
  }

  const zipped = zipSync(files, { level: 6 })
  const out = new Blob([zipped], { type: 'application/zip' })
  downloadBlob(out, `${basename}_pack.zip`)
  return {
    blob: out,
    textureFormat,
    geometryBytes: glbBytes.byteLength,
    textureBytes,
  }
}

export { formatBytes }
