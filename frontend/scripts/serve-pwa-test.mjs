import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
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
const fixtures = new Map()

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const fixtureId = request.headers.cookie?.match(/(?:^|;\s*)moods_test=([^;]+)/)?.[1]
  const fixture = fixtures.get(fixtureId)

  // Test-only HTTP fixtures work for Service Worker fetches too; browser route
  // interception does not cover those requests consistently across engines.
  if (url.pathname === '/__test__/diary' && request.method === 'POST') {
    const data = await requestJson(request)
    const id = randomUUID()
    fixtures.set(id, {
      entries: data.entries,
      account: data.account ?? 1,
      posts: 0,
      loseFirstResponse: data.loseFirstResponse,
    })
    response.setHeader('Set-Cookie', `moods_test=${id}; Path=/; HttpOnly; SameSite=Lax`)
    return json(response, 200, { ok: true })
  }
  if (url.pathname === '/__test__/status' && fixture)
    return json(response, 200, { posts: fixture.posts })
  if (url.pathname === '/__test__/account' && fixture && request.method === 'POST') {
    fixture.account = (await requestJson(request)).id
    return json(response, 200, { ok: true })
  }
  if (url.pathname === '/__test__/network' && fixture && request.method === 'POST') {
    fixture.offline = (await requestJson(request)).offline
    return json(response, 200, { ok: true })
  }
  if (fixture?.offline) {
    response.destroy()
    return
  }
  if (fixture && url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/config/') return json(response, 200, { encryption_enabled: true })
    if (url.pathname === '/api/auth/me/' && fixture.account)
      return json(response, 200, { id: fixture.account, username: `user${fixture.account}` })
    if (url.pathname === '/api/auth/logout/') {
      fixture.account = 0
      response.writeHead(204, securityHeaders).end()
      return
    }
    if (url.pathname === '/api/entries/' && request.method === 'POST') {
      fixture.posts++
      const body = await requestJson(request)
      const entry = { ...body, id: fixture.entries.length + 1, tags: [] }
      fixture.entries.push(entry)
      if (fixture.loseFirstResponse && fixture.posts === 1) {
        // Start the response before dropping it. Dropping a reused socket before
        // any headers lets Chromium retry at transport level, outside fetch().
        response.writeHead(201, { 'Content-Type': 'application/json' })
        response.write('{"id":')
        setImmediate(() => response.destroy())
        return
      }
      return json(response, 201, entry)
    }
    if (url.pathname === '/api/entries/grouped/') {
      const results = {}
      for (const entry of fixture.entries)
        (results[entry.timestamp.slice(0, 10)] ??= []).push(entry)
      return json(response, 200, { results, next_before: null })
    }
    if (url.pathname === '/api/entries/snapshot/')
      return json(
        response,
        200,
        fixture.entries.map(({ mood, note, anxiety, timestamp }) => ({
          mood,
          note,
          anxiety,
          timestamp,
        })),
      )
    if (url.pathname === '/api/entries/')
      return json(
        response,
        200,
        fixture.entries.map(({ mood, anxiety, timestamp }) => ({ mood, anxiety, timestamp })),
      )
    if (url.pathname === '/api/entries/date-range/')
      return json(response, 200, { first_date: fixture.entries[0]?.timestamp.slice(0, 10) ?? null })
    if (url.pathname === '/api/tags/') return json(response, 200, [])
    if (url.pathname === '/api/sharing/') return json(response, 200, { active: false })
  }

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

async function requestJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`PWA test server listening on http://127.0.0.1:${port}\n`)
})
