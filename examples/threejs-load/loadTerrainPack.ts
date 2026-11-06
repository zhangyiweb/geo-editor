/**
 * 数字孪生 / Three.js 工程侧加载示例（可复制到业务项目）。
 *
 * 依赖：three@0.187+
 * 配套文件：{stamp}.glb + {stamp}_diffuse.ktx2|jpg|png + {stamp}.meta.json
 *
 * 顶点 Y 为真实海拔（米）× verticalExaggeration；原点在选区中心。
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'

export type TerrainMetaV1 = {
  version: 1
  coordinateSystem: {
    kind: 'local-enu'
    origin: { lng: number; lat: number }
    axes: { x: 'east'; y: 'up'; z: 'south' }
  }
  bbox: {
    west: number
    south: number
    east: number
    north: number
  }
  sizeMeters: { width: number; depth: number }
  elevation: {
    mode: 'absolute'
    unit: 'meters'
    min: number
    max: number
    verticalExaggeration: number
  }
  files?: {
    geometry?: string
    diffuse?: string
    meta?: string
  }
}

export type LoadedTerrain = {
  root: THREE.Group
  mesh: THREE.Mesh
  meta: TerrainMetaV1
}

export type LoadTerrainPackOptions = {
  /** 资源目录，如 './terrain/' 或 CDN 前缀 */
  baseUrl: string
  /** 不含扩展名的时间戳名，如 20261106_093000 */
  basename: string
  renderer: THREE.WebGLRenderer
  /** Basis transcoder 目录（KTX2 需要） */
  transcoderPath?: string
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`加载失败 ${url}: ${res.status}`)
  return (await res.json()) as T
}

async function loadDiffuseMap(
  url: string,
  renderer: THREE.WebGLRenderer,
  transcoderPath: string,
): Promise<THREE.Texture> {
  if (url.endsWith('.ktx2')) {
    const ktx2 = new KTX2Loader()
      .setTranscoderPath(transcoderPath)
      .detectSupport(renderer)
    const map = await ktx2.loadAsync(url)
    ktx2.dispose()
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }

  const loader = new THREE.TextureLoader()
  const map = await loader.loadAsync(url)
  map.colorSpace = THREE.SRGBColorSpace
  return map
}

/**
 * 加载导出包中的几何 + 贴图 + meta，并挂上 MeshStandardMaterial。
 * 返回的 root 已位于本地 ENU 原点；可直接 scene.add(root)。
 */
export async function loadTerrainPack(
  options: LoadTerrainPackOptions,
): Promise<LoadedTerrain> {
  const base = options.baseUrl.replace(/\/?$/, '/')
  const { basename, renderer } = options
  const transcoderPath =
    options.transcoderPath ??
    'https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/libs/basis/'

  const meta = await fetchJson<TerrainMetaV1>(
    `${base}${basename}.meta.json`,
  )

  const geometryName = meta.files?.geometry ?? `${basename}.glb`
  const gltf = await new GLTFLoader().loadAsync(`${base}${geometryName}`)
  const mesh = gltf.scene.children[0] as THREE.Mesh | undefined
  if (!mesh) throw new Error('GLB 中未找到地形网格')

  const diffuseName = meta.files?.diffuse
  if (diffuseName) {
    const map = await loadDiffuseMap(
      `${base}${diffuseName}`,
      renderer,
      transcoderPath,
    )
    const prev = mesh.material
    mesh.material = new THREE.MeshStandardMaterial({
      map,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    })
    if (Array.isArray(prev)) prev.forEach((m) => m.dispose())
    else prev?.dispose()
  }

  const root = new THREE.Group()
  root.name = 'terrain-pack'
  root.userData.terrainMeta = meta
  root.add(mesh)

  return { root, mesh, meta }
}

/**
 * 将经纬度转为地形本地坐标（米）。
 * 与编辑器导出约定一致：X 东、Y 上、Z 南。
 */
export function lngLatToLocal(
  lng: number,
  lat: number,
  meta: TerrainMetaV1,
  elevMeters = 0,
): THREE.Vector3 {
  const { west, east, south, north } = meta.bbox
  const originLng = meta.coordinateSystem.origin.lng
  const originLat = meta.coordinateSystem.origin.lat
  const midLat = ((south + north) / 2) * (Math.PI / 180)
  const mPerDegLat = 111_320
  const mPerDegLng = 111_320 * Math.cos(midLat)
  const x = (lng - originLng) * mPerDegLng
  const z = (originLat - lat) * mPerDegLat // 南为正 Z
  const y = elevMeters * meta.elevation.verticalExaggeration
  // 校验点是否大致在 bbox 内（可选）
  void west
  void east
  return new THREE.Vector3(x, y, z)
}
