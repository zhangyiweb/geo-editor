# 地理编辑器 · Geo Editor

基于 **Three.js r187** + **Leaflet** + **Vite/TypeScript** 的网页地理地形编辑器：搜索地名/经纬度 → 框选区域 → DEM 挤压地形 → 多源卫星贴图（含局部精度）→ 三维预览与多格式导出。

## 功能

- **定位**：地名搜索（Nominatim）或经纬度跳转
- **选区**：矩形 / 圆形；主区域（蓝框）与局部精度区（黄框，可多块、拖拽调整、删除）
- **面积设定**：按当前模式设定主区域或局部精度区面积（保持比例 / 正方形·正圆）
- **DEM**：AWS Terrarium 高度网格；**真实海拔**（顶点 Y = 海拔米 × 垂直夸张）
- **贴图**：Esri / USGS / Bing / OSM / Mapbox（可选 Token）；整区与局部 zoom 分开调节
- **布局**：主屏为地图；右下角 300×300 三维小窗，点击放大对换；可一键收起
- **项目存档**：保存 / 打开 JSON（选区、局部精度、面板参数、地图视野）
- **贴图精修**：固定当前网格，上传 PS 修好的 JPG/PNG 预览；可应用到场景，或导出 `terrain.glb` / KTX2 / JPG
- **导出**（左侧面板「导出」弹窗）：
  - **可运行项目包**：ZIP（`index.html` + `assets/models/terrain.glb` 一体含贴图）
  - **分包 ZIP**：下载名带时间戳；包内固定 `terrain.glb` + `terrain_diffuse.ktx2` + meta
  - **GLB 一体**、**STL**、**仅贴图 JPEG/PNG**
- **工程接入**：见 `examples/threejs-load/`（`loadTerrainPack` + 坐标系说明）

## 开发

```bash
npm install
npm run dev
```

浏览器打开终端提示的本地地址。瓦片与 Nominatim 经 Vite 代理，避免 CORS。

```bash
npm run build    # 类型检查 + 生产构建
npm run preview  # 预览构建结果
```

## 使用提示

1. 左侧搜索定位，或在地图按住 **Shift** 拖拽框选主区域（可选矩形/圆形）
2. 调整 DEM / 贴图精度后点击「生成地形」
3. 切换「局部精度」，Shift 新增多块黄框，可拖动锚点调整；需要时「仅重建贴图」
4. 右下角三维小窗点击放大，› 收起；全屏后可用线框/网格开关
5. 点左侧面板「导出」选择格式。分包为 **GLB 几何 + KTX2**，Three.js 用 `GLTFLoader` + `KTX2Loader`。

大区域请降低精度，避免瓦片过多导致卡顿。

## 技术栈

| 部分 | 技术 |
|------|------|
| 构建 | Vite 8、TypeScript |
| 地图 | Leaflet 1.9 |
| 三维 | Three.js 0.187（OrbitControls、导出器） |
| DEM | AWS Terrarium |
| 压缩 | fflate（OBJ ZIP） |

## 许可

仅供学习与个人使用。地图与影像版权归各数据源所有（Esri、OSM、USGS 等）。
