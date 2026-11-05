export type ImageryProvider = {
  id: string
  name: string
  /** Tile URL; y is XYZ (north-origin) unless noted */
  url: (z: number, x: number, y: number, token?: string) => string
  maxZoom: number
  attribution: string
  needsKey?: boolean
  /** Esri/USGS use TMS-like path z/y/x */
  scheme?: 'xyz' | 'zyx'
}

function quadKey(z: number, x: number, y: number): string {
  let q = ''
  for (let i = z; i > 0; i--) {
    let digit = 0
    const mask = 1 << (i - 1)
    if ((x & mask) !== 0) digit += 1
    if ((y & mask) !== 0) digit += 2
    q += String(digit)
  }
  return q
}

export const IMAGERY_PROVIDERS: ImageryProvider[] = [
  {
    id: 'esri',
    name: 'Esri World Imagery',
    scheme: 'zyx',
    url: (z, x, y) => `/proxy/esri/${z}/${y}/${x}`,
    // 许多区域 z18+ 会返回 “Map data not yet available” 占位图
    maxZoom: 17,
    attribution: 'Tiles © Esri',
  },
  {
    id: 'usgs',
    name: 'USGS Imagery',
    scheme: 'zyx',
    url: (z, x, y) => `/proxy/usgs/${z}/${y}/${x}`,
    maxZoom: 16,
    attribution: 'USGS The National Map',
  },
  {
    id: 'bing',
    name: 'Bing Aerial',
    url: (z, x, y) => `/proxy/bing/a${quadKey(z, x, y)}.jpeg?g=1`,
    maxZoom: 18,
    attribution: '© Microsoft Bing',
  },
  {
    id: 'osm',
    name: 'OpenStreetMap（对照）',
    url: (z, x, y) => `/proxy/osm/${z}/${x}/${y}.png`,
    maxZoom: 18,
    attribution: '© OpenStreetMap contributors',
  },
  {
    id: 'mapbox',
    name: 'Mapbox Satellite',
    needsKey: true,
    url: (z, x, y, token) =>
      `/proxy/mapbox/v4/mapbox.satellite/${z}/${x}/${y}@2x.jpg?access_token=${token ?? ''}`,
    maxZoom: 18,
    attribution: '© Mapbox © Maxar',
  },
]

export function getProvider(id: string): ImageryProvider {
  return IMAGERY_PROVIDERS.find((p) => p.id === id) ?? IMAGERY_PROVIDERS[0]!
}

const TOKEN_KEY = 'geo-editor-mapbox-token'

export function getMapboxToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setMapboxToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export function providerTileUrl(
  provider: ImageryProvider,
  z: number,
  x: number,
  y: number,
): string {
  const token = provider.needsKey ? getMapboxToken() : undefined
  return provider.url(z, x, y, token)
}
