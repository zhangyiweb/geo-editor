import type { Mesh } from 'three'
import { exportGeometryGLB } from './exportGLTF'
import { getMeshDiffuseCanvas } from './exportOBJ'
import { canvasToKtx2 } from './encodeKtx2'
import { canvasToBlob } from '../terrain/TextureAtlas'
import { EXPORT_JPEG_QUALITY } from './optimizeExport'
import {
  buildTerrainMeta,
  terrainMetaToJson,
  type TerrainMeta,
} from '../sdk/terrainMeta'

export type TerrainPackContext = {
  demZoom: number
  textureZoom: number
  providerId: string
  verticalExaggeration: number
  minElev: number
  maxElev: number
  widthMeters: number
  depthMeters: number
  bbox: TerrainMeta['bbox']
  shape: TerrainMeta['shape']
}

export type TerrainTextureFormat = 'ktx2' | 'jpg' | 'png' | 'none'

export type BuiltTerrainAssets = {
  /** 仅文件名，如 20261106_120000.glb */
  basename: string
  glbBytes: Uint8Array
  diffuseBytes: Uint8Array | null
  diffuseName: string | null
  /** 预览包用的 JPEG/PNG 回退（KTX2 运行时失败时可换） */
  fallbackBytes: Uint8Array | null
  fallbackName: string | null
  textureFormat: TerrainTextureFormat
  meta: TerrainMeta
  metaJson: string
  geometryBytes: number
  textureBytes: number
}

export type BuildTerrainAssetsOptions = {
  /** 额外导出 JPEG/PNG 回退贴图（可运行预览包推荐开启） */
  includeImageFallback?: boolean
}

/** 生成几何 GLB + 漫反射贴图（优先 KTX2）+ meta */
export async function buildTerrainAssets(
  mesh: Mesh,
  basename: string,
  ctx: TerrainPackContext,
  options: BuildTerrainAssetsOptions = {},
): Promise<BuiltTerrainAssets> {
  const glb = await exportGeometryGLB(mesh)
  const glbBytes = new Uint8Array(glb)

  let textureFormat: TerrainTextureFormat = 'none'
  let diffuseBytes: Uint8Array | null = null
  let diffuseName: string | null = null
  let fallbackBytes: Uint8Array | null = null
  let fallbackName: string | null = null
  let textureBytes = 0
  const canvas = getMeshDiffuseCanvas(mesh)

  if (canvas) {
    const needsAlpha = mesh.userData.shape === 'circle'
    try {
      if (needsAlpha) {
        const png = await canvasToBlob(canvas, 'image/png')
        diffuseBytes = new Uint8Array(await png.arrayBuffer())
        diffuseName = `${basename}_diffuse.png`
        textureFormat = 'png'
        textureBytes = diffuseBytes.byteLength
      } else {
        const ktx2 = await canvasToKtx2(canvas)
        diffuseBytes = ktx2
        diffuseName = `${basename}_diffuse.ktx2`
        textureFormat = 'ktx2'
        textureBytes = ktx2.byteLength
      }
    } catch (err) {
      console.warn('KTX2 encode failed, fallback to JPEG/PNG', err)
      const blob = needsAlpha
        ? await canvasToBlob(canvas, 'image/png')
        : await canvasToBlob(canvas, 'image/jpeg', EXPORT_JPEG_QUALITY)
      diffuseBytes = new Uint8Array(await blob.arrayBuffer())
      const ext = needsAlpha ? 'png' : 'jpg'
      diffuseName = `${basename}_diffuse.${ext}`
      textureFormat = ext
      textureBytes = diffuseBytes.byteLength
    }

    if (
      options.includeImageFallback &&
      textureFormat === 'ktx2' &&
      !needsAlpha
    ) {
      const jpg = await canvasToBlob(canvas, 'image/jpeg', EXPORT_JPEG_QUALITY)
      fallbackBytes = new Uint8Array(await jpg.arrayBuffer())
      fallbackName = `${basename}_diffuse.jpg`
    }
  }

  const meta = buildTerrainMeta({
    ...ctx,
    basename,
    textureExt: textureFormat,
  })
  if (fallbackName && meta.files) {
    meta.files.fallbackDiffuse = fallbackName
  }

  return {
    basename,
    glbBytes,
    diffuseBytes,
    diffuseName,
    fallbackBytes,
    fallbackName,
    textureFormat,
    meta,
    metaJson: terrainMetaToJson(meta),
    geometryBytes: glbBytes.byteLength,
    textureBytes,
  }
}
