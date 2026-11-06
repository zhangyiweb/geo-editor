import type { BBox, SelectionShape } from '../geo/bbox'
import { bboxCenter, normalizeBBox } from '../geo/bbox'

/** 导出包 / GLB 旁路的地形元数据（数字孪生对接用） */
export type TerrainMeta = {
  version: 1
  generatedAt: string
  /** 本地 ENU 米制；原点在选区中心 */
  coordinateSystem: {
    kind: 'local-enu'
    origin: { lng: number; lat: number }
    /**
     * Three.js Y-up：
     * X = 东，Y = 上（海拔米），Z = 南（北向为 -Z）
     */
    axes: { x: 'east'; y: 'up'; z: 'south' }
  }
  bbox: BBox
  shape: SelectionShape
  sizeMeters: {
    /** 东西向宽度 */
    width: number
    /** 南北向深度（沿本地 Z） */
    depth: number
  }
  elevation: {
    /** 顶点 Y = elevMeters * verticalExaggeration（真实海拔） */
    mode: 'absolute'
    unit: 'meters'
    min: number
    max: number
    verticalExaggeration: number
  }
  demZoom: number
  textureZoom: number
  providerId: string
  files?: {
    geometry?: string
    diffuse?: string
    /** KTX2 失败时可用的 JPEG/PNG */
    fallbackDiffuse?: string
    meta?: string
  }
}

export type BuildTerrainMetaInput = {
  bbox: BBox
  shape: SelectionShape
  widthMeters: number
  depthMeters: number
  minElev: number
  maxElev: number
  verticalExaggeration: number
  demZoom: number
  textureZoom: number
  providerId: string
  basename?: string
  textureExt?: 'ktx2' | 'jpg' | 'png' | 'none'
}

export function buildTerrainMeta(input: BuildTerrainMetaInput): TerrainMeta {
  const bbox = normalizeBBox(input.bbox)
  const origin = bboxCenter(bbox)
  const stamp = input.basename
  const tex =
    input.textureExt && input.textureExt !== 'none' && stamp
      ? `${stamp}_diffuse.${input.textureExt}`
      : undefined

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    coordinateSystem: {
      kind: 'local-enu',
      origin,
      axes: { x: 'east', y: 'up', z: 'south' },
    },
    bbox,
    shape: input.shape,
    sizeMeters: {
      width: input.widthMeters,
      depth: input.depthMeters,
    },
    elevation: {
      mode: 'absolute',
      unit: 'meters',
      min: input.minElev,
      max: input.maxElev,
      verticalExaggeration: input.verticalExaggeration,
    },
    demZoom: input.demZoom,
    textureZoom: input.textureZoom,
    providerId: input.providerId,
    files: stamp
      ? {
          geometry: `${stamp}.glb`,
          diffuse: tex,
          meta: `${stamp}.meta.json`,
        }
      : undefined,
  }
}

export function terrainMetaToJson(meta: TerrainMeta): string {
  return `${JSON.stringify(meta, null, 2)}\n`
}
