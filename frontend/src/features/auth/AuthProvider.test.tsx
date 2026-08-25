import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { api } from '../../shared/api/client'
import { ENC_KEY_STORAGE, WRAPPED_KEY_STORAGE } from '../../shared/crypto/crypto'
import { useAuth } from './AuthContext'
import { AuthProvider } from './AuthProvider'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function notAuthenticated(): Response {
  return json({ error: { code: 'not_authenticated', message: 'Войдите снова' } }, 401)
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

function renderProvider() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { ...result, client }
}

function Probe() {
  const auth = useAuth()
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="message">{auth.sessionMessage}</span>
      <button type="button" onClick={auth.retryBootstrap}>
        retry
      </button>
      <button
        type="button"
        onClick={() => {
          void api.get('/api/private/', z.object({ ok: z.boolean() })).catch(() => undefined)
        }}
      >
        private request
      </button>
    </div>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

describe('AuthProvider bootstrap', () => {
  it('не открывает приложение при несовместимой конфигурации и позволяет повторить', async () => {
    let configAttempts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const url = requestUrl(input)
        if (url === '/api/config/') {
          configAttempts++
          return configAttempts === 1
            ? json({ encryption_enabled: 'yes' })
            : json({ encryption_enabled: false })
        }
        if (url === '/api/auth/me/') return notAuthenticated()
        throw new Error(`Неожиданный URL: ${url}`)
      }),
    )

    renderProvider()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('invalid-config'))
    await userEvent.click(screen.getByRole('button', { name: 'retry' }))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anon'))
    expect(configAttempts).toBe(2)
  })

  it('различает offline и недоступный сервер', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')))

    renderProvider()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('offline'))
  })
})

describe('завершение сессии', () => {
  it('очищает session key и query state, но сохраняет wrapped key для повторного входа', async () => {
    let privateRequest = false
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const url = requestUrl(input)
        if (url === '/api/config/') return json({ encryption_enabled: false })
        if (url === '/api/auth/me/') return json({ id: 1, username: 'user' })
        if (url === '/api/private/' && privateRequest) return notAuthenticated()
        throw new Error(`Неожиданный URL: ${url}`)
      }),
    )

    const { client } = renderProvider()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authed'))
    client.setQueryData(['entries'], { private: true })
    sessionStorage.setItem(ENC_KEY_STORAGE, 'session-secret')
    localStorage.setItem(WRAPPED_KEY_STORAGE, 'wrapped-secret')
    privateRequest = true

    await userEvent.click(screen.getByRole('button', { name: 'private request' }))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anon'))
    expect(screen.getByTestId('message')).toHaveTextContent('Сессия закончилась, войдите снова')
    expect(sessionStorage.getItem(ENC_KEY_STORAGE)).toBeNull()
    expect(localStorage.getItem(WRAPPED_KEY_STORAGE)).toBe('wrapped-secret')
    expect(client.getQueryData(['entries'])).toBeUndefined()
  })

  it('не показывает сообщение об истёкшей сессии при первом анонимном запуске', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async (input) =>
          requestUrl(input) === '/api/config/'
            ? json({ encryption_enabled: false })
            : notAuthenticated(),
        ),
    )

    renderProvider()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anon'))
    expect(screen.getByTestId('message')).toBeEmptyDOMElement()
  })
})
