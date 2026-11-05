import { defineConfig } from 'vite'

export default defineConfig({
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    exclude: ['ktx2-encoder'],
  },
  server: {
    proxy: {
      '/proxy/nominatim': {
        target: 'https://nominatim.openstreetmap.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/nominatim/, ''),
        headers: {
          'User-Agent': 'GeoEditor/1.0 (local development; contact@localhost)',
        },
      },
      '/proxy/terrarium': {
        target: 'https://s3.amazonaws.com',
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(/^\/proxy\/terrarium/, '/elevation-tiles-prod/terrarium'),
      },
      '/proxy/esri': {
        target: 'https://server.arcgisonline.com',
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(
            /^\/proxy\/esri/,
            '/ArcGIS/rest/services/World_Imagery/MapServer/tile',
          ),
      },
      '/proxy/osm': {
        target: 'https://tile.openstreetmap.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/osm/, ''),
        headers: {
          'User-Agent': 'GeoEditor/1.0 (local development)',
        },
      },
      '/proxy/usgs': {
        target: 'https://basemap.nationalmap.gov',
        changeOrigin: true,
        rewrite: (path) =>
          path.replace(
            /^\/proxy\/usgs/,
            '/arcgis/rest/services/USGSImageryOnly/MapServer/tile',
          ),
      },
      '/proxy/bing': {
        target: 'https://ecn.t0.tiles.virtualearth.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/bing/, '/tiles'),
      },
      '/proxy/mapbox': {
        target: 'https://api.mapbox.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy\/mapbox/, ''),
      },
    },
  },
})
