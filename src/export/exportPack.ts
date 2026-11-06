import { zipSync, strToU8 } from 'fflate'
import type { Mesh } from 'three'
import { downloadBlob } from './exportGLTF'
import { formatBytes } from './optimizeExport'
import {
  buildTerrainAssets,
  type TerrainPackContext,
} from './buildTerrainAssets'
import type { TerrainMeta } from '../sdk/terrainMeta'
import { VIEWER_MODEL_BASENAME } from './assetNames'

export type { TerrainPackContext }

const LOAD_HINT = `Three.js 加载示例（几何 GLB + KTX2 + meta）
========================================
包内文件名固定（便于覆盖替换）：
  terrain.glb
  terrain_diffuse.ktx2（或 jpg/png）
  terrain.meta.json

ZIP 文件名带时间戳，内容始终用上述固定名。
详见仓库 examples/threejs-load/（可复制 loadTerrainPack.ts）。

要点：
- terrain.meta.json 含原点经纬度、轴向、真实海拔范围
- Y = 海拔米 × verticalExaggeration（绝对高程）
- X=东，Y=上，Z=南
- KTX2 宽高已对齐为 4 的倍数，避免 GPU 上传失败
`

export type TerrainPackResult = {
  blob: Blob
  textureFormat: 'ktx2' | 'jpg' | 'png' | 'none'
  geometryBytes: number
  textureBytes: number
  meta: TerrainMeta
  zipName: string
}

/**
 * 网格+贴图分包：
 * 包内固定名 terrain.* ；ZIP 下载名用时间戳 `{stamp}_pack.zip`。
 */
export async function exportTerrainPack(
  mesh: Mesh,
  stamp: string,
  ctx: TerrainPackContext,
): Promise<TerrainPackResult> {
  const basename = VIEWER_MODEL_BASENAME
  const assets = await buildTerrainAssets(mesh, basename, ctx)

  const files: Record<string, Uint8Array> = {
    [`${basename}.glb`]: assets.glbBytes,
    [`${basename}.meta.json`]: strToU8(assets.metaJson),
    'README_加载说明.txt': strToU8(LOAD_HINT),
  }

  if (assets.diffuseBytes && assets.diffuseName) {
    files[assets.diffuseName] = assets.diffuseBytes
  }

  const zipName = `${stamp}_pack.zip`
  const zipped = zipSync(files, { level: 6 })
  const out = new Blob([zipped], { type: 'application/zip' })
  downloadBlob(out, zipName)
  return {
    blob: out,
    textureFormat: assets.textureFormat,
    geometryBytes: assets.geometryBytes,
    textureBytes: assets.textureBytes,
    meta: assets.meta,
    zipName,
  }
}

export { formatBytes }
