import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const distDir = path.join(projectRoot, 'dist')
const indexHtml = path.join(distDir, 'index.html')

const routes = ['anime']

for (const route of routes) {
  const routeDir = path.join(distDir, route)
  await mkdir(routeDir, { recursive: true })
  await copyFile(indexHtml, path.join(routeDir, 'index.html'))
}

console.log(`Created SPA route fallbacks: ${routes.map((route) => `/maps/${route}/`).join(', ')}`)
