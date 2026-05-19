import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (id.includes('recharts')) {
            return 'charts';
          }

          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 6001,
    proxy: {
      '/api': {
        target: 'http://localhost:6000',
        changeOrigin: true
      }
    }
  }
})
