export type GeocodeResult = {
  displayName: string
  lat: number
  lng: number
  bbox: {
    west: number
    south: number
    east: number
    north: number
  } | null
}

/** Parse "lng,lat" or "lat,lng" or "lat lng". Prefer lat,lng when |a|<=90. */
export function parseLatLng(input: string): { lat: number; lng: number } | null {
  const s = input.trim()
  const m = s.match(/^([+-]?\d+(\.\d+)?)\s*[,，\s]\s*([+-]?\d+(\.\d+)?)$/)
  if (!m) return null
  const a = parseFloat(m[1]!)
  const b = parseFloat(m[3]!)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null

  // If first looks like longitude (|a|>90) treat as lng,lat
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) {
    return { lng: a, lat: b }
  }
  // Default: lat,lng
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
    return { lat: a, lng: b }
  }
  if (Math.abs(b) <= 90 && Math.abs(a) <= 180) {
    return { lng: a, lat: b }
  }
  return null
}

export async function geocode(query: string): Promise<GeocodeResult[]> {
  const coords = parseLatLng(query)
  if (coords) {
    const pad = 0.05
    return [
      {
        displayName: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`,
        lat: coords.lat,
        lng: coords.lng,
        bbox: {
          west: coords.lng - pad,
          south: coords.lat - pad,
          east: coords.lng + pad,
          north: coords.lat + pad,
        },
      },
    ]
  }

  const url =
    `/proxy/nominatim/search?` +
    new URLSearchParams({
      q: query,
      format: 'json',
      limit: '5',
      addressdetails: '0',
    }).toString()

  const res = await fetch(url)
  if (!res.ok) throw new Error(`地理编码失败: ${res.status}`)
  const data = (await res.json()) as Array<{
    display_name: string
    lat: string
    lon: string
    boundingbox?: [string, string, string, string]
  }>

  return data.map((item) => {
    let bbox: GeocodeResult['bbox'] = null
    if (item.boundingbox && item.boundingbox.length === 4) {
      const [south, north, west, east] = item.boundingbox.map(Number)
      bbox = { west: west!, south: south!, east: east!, north: north! }
    }
    return {
      displayName: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      bbox,
    }
  })
}
