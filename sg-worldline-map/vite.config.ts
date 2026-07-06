import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// sg-wiki.github.io/maps/ 서브경로 배포.
// CI에서 dist/ → site/maps/로 post-copy됨 (PRD Option D).
export default defineConfig({
  plugins: [react()],
  base: '/maps/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
