import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MAX_JS_CHUNK_GZIP = 80 * 1024
const MAX_ROUTE_CSS_GZIP = 15 * 1024
// Count the complete static import graph, so splitting a large dependency into
// several chunks cannot hide a startup-size regression.
const MAX_ROUTE_GZIP_KIB = { app: 125, share: 120, 'not-found': 115 }
const buildDir = resolve('dist')
const manifestPath = resolve(buildDir, '.vite/manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const routeRoots = {
  app: ['index.html', 'src/pages/AppPage/AppPage.tsx', 'src/features/entries/EntriesTab.tsx'],
  share: ['index.html', 'src/pages/SharePage/SharePage.tsx'],
  'not-found': ['index.html', 'src/pages/NotFoundPage.tsx'],
}

function record(key) {
  const value = manifest[key]
  if (!value || typeof value !== 'object') throw new Error(`Нет build manifest entry: ${key}`)
  return value
}

function gzipBytes(file) {
  return gzipSync(readFileSync(resolve(buildDir, file))).byteLength
}

function collectFiles(keys) {
  const visited = new Set()
  const files = new Set()
  const visit = (key) => {
    if (visited.has(key)) return
    visited.add(key)
    const value = record(key)
    files.add(value.file)
    for (const file of value.css ?? []) files.add(file)
    for (const dependency of value.imports ?? []) visit(dependency)
  }
  keys.forEach(visit)
  return files
}

const failures = []
const jsFiles = new Set(
  Object.values(manifest)
    .map((value) => value.file)
    .filter((file) => typeof file === 'string' && file.endsWith('.js')),
)

for (const file of jsFiles) {
  const size = gzipBytes(file)
  if (size > MAX_JS_CHUNK_GZIP) {
    failures.push(`${file}: ${(size / 1024).toFixed(2)} KiB gzip > ${MAX_JS_CHUNK_GZIP / 1024} KiB`)
  }
}

for (const [route, roots] of Object.entries(routeRoots)) {
  const files = [...collectFiles(roots)]
  const size = files.reduce((total, file) => total + gzipBytes(file), 0)
  const cssSize = files
    .filter((file) => file.endsWith('.css'))
    .reduce((total, file) => total + gzipBytes(file), 0)
  process.stdout.write(
    `${route}: ${files.length} files, ${(size / 1024).toFixed(2)} KiB gzip (CSS ${(cssSize / 1024).toFixed(2)} KiB)\n`,
  )
  if (size > MAX_ROUTE_GZIP_KIB[route] * 1024)
    failures.push(
      `${route}: ${(size / 1024).toFixed(2)} KiB gzip > ${MAX_ROUTE_GZIP_KIB[route]} KiB`,
    )
  if (cssSize > MAX_ROUTE_CSS_GZIP) {
    failures.push(
      `${route} CSS: ${(cssSize / 1024).toFixed(2)} KiB gzip > ${MAX_ROUTE_CSS_GZIP / 1024} KiB`,
    )
  }
}

const cssText = [...new Set(Object.values(manifest).flatMap((value) => value.css ?? []))]
  .map((file) => readFileSync(resolve(buildDir, file), 'utf8'))
  .join('\n')

if (!/(^|[;}])backdrop-filter:/.test(cssText)) {
  failures.push('В production CSS отсутствует backdrop-filter')
}
if (!cssText.includes('-webkit-backdrop-filter:')) {
  failures.push('В production CSS отсутствует -webkit-backdrop-filter')
}

if (failures.length) {
  throw new Error(`Build budgets failed:\n${failures.map((item) => `- ${item}`).join('\n')}`)
}

process.stdout.write('Build budgets and backdrop-filter checks passed.\n')
