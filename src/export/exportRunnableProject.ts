import { zipSync, strToU8 } from 'fflate'
import type { Mesh } from 'three'
import { downloadBlob, exportGLB } from './exportGLTF'
import { formatBytes } from './optimizeExport'
import type { TerrainPackContext, TerrainPackResult } from './exportPack'
import { buildTerrainMeta, terrainMetaToJson } from '../sdk/terrainMeta'
import { VIEWER_MODEL_BASENAME, VIEWER_ZIP_NAME } from './assetNames'

export { VIEWER_MODEL_BASENAME, VIEWER_ZIP_NAME }

/** 一体 GLB 预览页：网格+贴图已嵌入，无需 KTX2Loader */
function buildViewerHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>terrain</title>
<style>
html,body{margin:0;height:100%;overflow:hidden;background:#0b1220}
canvas{display:block}
</style>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/"
  }
}
</script>
</head>
<body>
<script type="module">
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0b1220)

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1e6)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

scene.add(new THREE.AmbientLight(0xffffff, 0.4))
const sun = new THREE.DirectionalLight(0xffffff, 8)
scene.add(sun)

const gltf = await new GLTFLoader().loadAsync('./assets/models/terrain.glb')
scene.add(gltf.scene)

const box = new THREE.Box3().setFromObject(gltf.scene)
const size = box.getSize(new THREE.Vector3())
const center = box.getCenter(new THREE.Vector3())
controls.target.copy(center)
const r = Math.max(size.x, size.y, size.z, 1)
sun.target.position.copy(center)
sun.position.set(center.x + r, center.y + r * 1.5, center.z + r * 0.5)
scene.add(sun.target)
camera.position.set(center.x + r * 0.6, center.y + r * 0.7, center.z + r * 0.8)
camera.near = Math.max(0.1, r / 1000)
camera.far = r * 40
camera.updateProjectionMatrix()

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

;(function loop() {
  requestAnimationFrame(loop)
  controls.update()
  renderer.render(scene, camera)
})()
</script>
</body>
</html>
`
}

/** 可运行包：一体 GLB（含贴图）+ 极简预览页 */
export async function exportRunnableProject(
  mesh: Mesh,
  ctx: TerrainPackContext,
): Promise<TerrainPackResult> {
  const basename = VIEWER_MODEL_BASENAME
  const glb = await exportGLB(mesh)
  const glbBytes = new Uint8Array(glb)

  const meta = buildTerrainMeta({
    ...ctx,
    basename,
    textureExt: 'jpg',
  })
  if (meta.files) {
    meta.files.geometry = `${basename}.glb`
    meta.files.diffuse = undefined
    meta.files.fallbackDiffuse = undefined
  }

  const files: Record<string, Uint8Array> = {
    'index.html': strToU8(buildViewerHtml()),
    [`assets/models/${basename}.glb`]: glbBytes,
    [`assets/models/${basename}.meta.json`]: strToU8(terrainMetaToJson(meta)),
  }

  const zipped = zipSync(files, { level: 6 })
  const out = new Blob([zipped], { type: 'application/zip' })
  downloadBlob(out, VIEWER_ZIP_NAME)

  return {
    blob: out,
    textureFormat: 'jpg',
    geometryBytes: glbBytes.byteLength,
    textureBytes: 0,
    meta,
  }
}

export { formatBytes }
