import type { BBox, SelectionShape, TexturePatch } from '../geo/bbox'
import type { PanelValues } from '../ui/panel'

export const PROJECT_FILE_VERSION = 1 as const

/** 地理编辑器项目存档（不含网格本体，可复现选区与参数） */
export type GeoEditorProject = {
  version: typeof PROJECT_FILE_VERSION
  kind: 'geo-editor-project'
  savedAt: string
  panel: PanelValues
  main: {
    bbox: BBox
    shape: SelectionShape
  } | null
  patches: TexturePatch[]
  mapView: {
    lat: number
    lng: number
    zoom: number
  }
}

export function createProject(input: {
  panel: PanelValues
  main: GeoEditorProject['main']
  patches: TexturePatch[]
  mapView: GeoEditorProject['mapView']
}): GeoEditorProject {
  return {
    version: PROJECT_FILE_VERSION,
    kind: 'geo-editor-project',
    savedAt: new Date().toISOString(),
    panel: { ...input.panel },
    main: input.main
      ? { bbox: { ...input.main.bbox }, shape: input.main.shape }
      : null,
    patches: input.patches.map((p) => ({
      ...p,
      bbox: { ...p.bbox },
    })),
    mapView: { ...input.mapView },
  }
}

export function projectToJson(project: GeoEditorProject): string {
  return `${JSON.stringify(project, null, 2)}\n`
}

export function parseProjectJson(text: string): GeoEditorProject {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('项目文件不是合法 JSON')
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('项目文件格式无效')
  }
  const obj = raw as Record<string, unknown>
  if (obj.kind !== 'geo-editor-project') {
    throw new Error('不是地理编辑器项目文件')
  }
  if (obj.version !== 1) {
    throw new Error(`不支持的项目版本：${String(obj.version)}`)
  }
  if (!obj.panel || typeof obj.panel !== 'object') {
    throw new Error('项目缺少 panel 字段')
  }
  if (!obj.mapView || typeof obj.mapView !== 'object') {
    throw new Error('项目缺少 mapView 字段')
  }
  if (!Array.isArray(obj.patches)) {
    throw new Error('项目 patches 必须是数组')
  }
  return obj as unknown as GeoEditorProject
}
