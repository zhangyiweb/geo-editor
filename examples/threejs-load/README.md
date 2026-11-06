# Three.js 地形加载示例

配合编辑器「GLB 几何 + KTX2 贴图包」导出使用。

## 包内文件

| 文件 | 说明 |
|------|------|
| `terrain.glb` | 无贴图几何（包内固定名） |
| `terrain_diffuse.ktx2`（或 jpg/png） | 漫反射贴图 |
| `terrain.meta.json` | 坐标系 / 真实高程 / 范围 |

ZIP 下载名带时间戳（如 `20261106_105300_pack.zip`），解压后文件名始终固定。

## 坐标系

- 原点：选区中心经纬度（见 `meta.coordinateSystem.origin`）
- **X = 东，Y = 上（真实海拔米），Z = 南**（北向为 `-Z`）
- 顶点 `Y = elevMeters * verticalExaggeration`（默认可为 `1`）

## 快速接入

```ts
import { loadTerrainPack, lngLatToLocal } from './loadTerrainPack'

const { root, meta } = await loadTerrainPack({
  baseUrl: './terrain/',
  basename: 'terrain',
  renderer,
})
scene.add(root)

// 把厂区某点（经纬度 + 海拔）摆到场景里
const p = lngLatToLocal(118.15, 30.12, meta, 420)
building.position.copy(p)
```

完整加载逻辑见同目录 `loadTerrainPack.ts`（可直接复制到业务仓库）。
