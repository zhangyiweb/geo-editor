/** Approximate ground resolution at equator for Web Mercator tile zoom. */
export function metersPerPixel(zoom: number, latitude = 30): number {
  const latRad = (latitude * Math.PI) / 180
  return (156543.03392 * Math.cos(latRad)) / Math.pow(2, zoom)
}

export type PrecisionGrade = {
  level: string
  label: string
  detail: string
}

/** Human-readable grade for a tile zoom used as texture/DEM precision. */
export function describePrecision(
  zoom: number,
  kind: 'texture' | 'dem' = 'texture',
  latitude = 30,
): PrecisionGrade {
  const mpp = metersPerPixel(zoom, latitude)
  const res =
    mpp >= 10
      ? `约 ${mpp.toFixed(0)} m/像素`
      : mpp >= 1
        ? `约 ${mpp.toFixed(1)} m/像素`
        : `约 ${(mpp * 100).toFixed(0)} cm/像素`

  let level: string
  let label: string
  if (zoom <= 10) {
    level = 'L1'
    label = '概览级'
  } else if (zoom <= 12) {
    level = 'L2'
    label = '区域级'
  } else if (zoom <= 14) {
    level = 'L3'
    label = '街区级'
  } else if (zoom <= 16) {
    level = 'L4'
    label = '细节级'
  } else if (zoom <= 18) {
    level = 'L5'
    label = '高清级'
  } else {
    level = 'L6'
    label = '超清级'
  }

  const kindText = kind === 'dem' ? '地形高度采样' : '卫星贴图'
  return {
    level,
    label,
    detail: `z${zoom} · ${label}（${level}）· ${kindText} ${res}`,
  }
}
