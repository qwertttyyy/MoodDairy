import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const port = Number.parseInt(process.env.PWA_TEST_PORT ?? '4174', 10)
const buildDir = resolve(process.env.PWA_TEST_ROOT ?? 'dist')
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
])
const securityHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (url.pathname === '/api/config/') {
    return json(response, 200, { encryption_enabled: false })
  }
  if (url.pathname === '/api/auth/me/') {
    return json(response, 401, {
      error: { code: 'not_authenticated', message: 'Войдите снова' },
    })
  }
  if (url.pathname === '/api/health/') {
    return json(response, 200, { status: 'ok' })
  }
  if (url.pathname.startsWith('/api/')) {
    return json(response, 404, { error: { code: 'not_found', message: 'Нет' } })
  }

  const isNavigation = url.pathname === '/' || /^\/share\/[^/]+\/?$/.test(url.pathname)
  const relativePath = isNavigation
    ? 'index.html'
    : decodeURIComponent(url.pathname).replace(/^\/+/, '')
  const filePath = resolve(buildDir, relativePath)
  if (filePath !== buildDir && !filePath.startsWith(`${buildDir}${sep}`)) {
    response.writeHead(404).end()
    return
  }

  try {
    const body = await readFile(filePath)
    const cacheControl = url.pathname.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : ['/', '/index.html', '/manifest.webmanifest', '/sw.js', '/theme-init.js'].includes(
            url.pathname,
          )
        ? 'no-cache'
        : 'public, max-age=86400'
    response.writeHead(200, {
      'Content-Type': contentTypes.get(extname(filePath)) ?? 'application/octet-stream',
      'Cache-Control': cacheControl,
      ...securityHeaders,
    })
    response.end(body)
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  }
})

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...securityHeaders,
  })
  response.end(JSON.stringify(body))
}

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`PWA test server listening on http://127.0.0.1:${port}\n`)
})
