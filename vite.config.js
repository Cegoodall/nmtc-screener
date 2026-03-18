import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy Census geocoder — CORS not allowed from browser
      '/api/geocode': {
        target: 'https://geocoding.geo.census.gov',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/geocode/, '/geocoder/geographies/address'),
        secure: true,
      },
      // Proxy Census coordinates-to-geography — used as fallback
      '/api/geocode-coords': {
        target: 'https://geocoding.geo.census.gov',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/geocode-coords/, '/geocoder/geographies/coordinates'),
        secure: true,
      },
      // Proxy Nominatim (OpenStreetMap) — fallback address geocoder
      '/api/nominatim': {
        target: 'https://nominatim.openstreetmap.org',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/nominatim/, ''),
        secure: true,
        headers: { 'User-Agent': 'NMTC-Screener/1.0' },
      },
      // Proxy SBA HUBZone — CORS not allowed from browser
      '/api/hubzone-proxy': {
        target: 'https://maps.certify.sba.gov',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/hubzone-proxy/, '/api/hubzone'),
        secure: true,
        headers: {
          'Accept': 'application/json',
        },
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/xlsx')) return 'xlsx';
          if (id.includes('node_modules/pdfjs-dist')) return 'pdfjs';
        },
      },
    },
  },
  optimizeDeps: {
    include: ['xlsx'],
    exclude: ['pdfjs-dist'],
  },
})
