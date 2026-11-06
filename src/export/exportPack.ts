import { zipSync, strToU8 } from 'fflate'
import type { Mesh } from 'three'
import { downloadBlob } from './exportGLTF'
import { formatBytes } from './optimizeExport'
import {
  buildTerrainAssets,
  type TerrainPackContext,
} from './buildTerrainAssets'
import type { TerrainMeta } from '../sdk/terrainMeta'

export type { TerrainPackContext }

const LOAD_HINT = `Three.js 加载示例（几何 GLB + KTX2 + meta）
========================================
详见仓库 examples/threejs-load/（可复制 loadTerrainPack.ts）。
若需要开箱即用的预览页，请改用导出「可运行项目包」。

要点：
- {stamp}.meta.json 含原点经纬度、轴向、真实海拔范围
- Y = 海拔米 × verticalExaggeration（绝对高程）
- X=东，Y=上，Z=南

KTX2（ETC1S）通常更小且 GPU 直传更快；失败时回退为 jpg/png。
`

export type TerrainPackResult = {
  blob: Blob
  textureFormat: 'ktx2' | 'jpg' | 'png' | 'none'
  geometryBytes: number
  textureBytes: number
  meta: TerrainMeta
}

/** 网格+贴图分包：{stamp}.glb + 贴图 + {stamp}.meta.json */
export async function exportTerrainPack(
  mesh: Mesh,
  basename: string,
  ctx: TerrainPackContext,
): Promise<TerrainPackResult> {
  const assets = await buildTerrainAssets(mesh, basename, ctx)

  const files: Record<string, Uint8Array> = {
    [`${basename}.glb`]: assets.glbBytes,
    [`${basename}.meta.json`]: strToU8(assets.metaJson),
    'README_加载说明.txt': strToU8(LOAD_HINT),
  }

  if (assets.diffuseBytes && assets.diffuseName) {
    files[assets.diffuseName] = assets.diffuseBytes
  }

  const zipped = zipSync(files, { level: 6 })
  const out = new Blob([zipped], { type: 'application/zip' })
  downloadBlob(out, `${basename}_pack.zip`)
  return {
    blob: out,
    textureFormat: assets.textureFormat,
    geometryBytes: assets.geometryBytes,
    textureBytes: assets.textureBytes,
    meta: assets.meta,
  }
}

export { formatBytes }
