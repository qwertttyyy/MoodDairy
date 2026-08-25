import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  ApiError,
  IncompatibleApiResponseError,
  NetworkError,
  RequestTimeoutError,
  api,
  parseApiError,
  shouldRetry,
} from './client'

const objectSchema = z.object({ id: z.number() })
const privateError = {
  error: {
    code: 'validation_error',
    message: 'Проверьте поля',
    request_id: 'req-1',
    fields: { username: ['Имя пользователя занято'] },
    private_note: 'не должно попасть в исключение',
  },
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

function stubFetch(response: Response) {
  const mock = vi.fn<typeof fetch>().mockResolvedValue(response)
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('API boundary', () => {
  beforeEach(() => {
    document.cookie = 'csrftoken=token-123'
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  })

  it('разбирает стабильный конверт ошибки без лишних данных', () => {
    expect(parseApiError(privateError)).toEqual({
      code: 'validation_error',
      message: 'Проверьте поля',
      fields: { username: ['Имя пользователя занято'] },
      requestId: 'req-1',
    })
  })

  it('повторяет только сеть, timeout и 5xx — не более одного раза', () => {
    const payload = { code: 'error', message: 'Ошибка', fields: {}, requestId: 'req-1' }
    expect(shouldRetry(0, new NetworkError(new TypeError()))).toBe(true)
    expect(shouldRetry(0, new RequestTimeoutError(20))).toBe(true)
    expect(shouldRetry(0, new ApiError(503, payload))).toBe(true)
    expect(shouldRetry(1, new ApiError(503, payload))).toBe(false)
    expect(shouldRetry(0, new ApiError(401, payload))).toBe(false)
    expect(shouldRetry(0, new IncompatibleApiResponseError([]))).toBe(false)
  })

  it('валидирует успешный ответ и отбрасывает неизвестные поля', async () => {
    stubFetch(jsonResponse({ id: 7, private_note: 'не сохранять' }))
    await expect(api.get('/api/value/', objectSchema)).resolves.toEqual({ id: 7 })
  })

  it('отклоняет несовместимый ответ без сохранения его содержимого', async () => {
    stubFetch(jsonResponse({ id: 'secret-invalid-value' }))
    const error = await api.get('/api/value/', objectSchema).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(IncompatibleApiResponseError)
    expect(JSON.stringify(error)).not.toContain('secret-invalid-value')
  })

  it('передаёт cookie-сессию, CSRF и JSON body', async () => {
    const mock = stubFetch(jsonResponse({ id: 1 }, 201))
    await api.post('/api/entries/', { mood: 4 }, objectSchema)
    const call = mock.mock.calls[0]
    if (!call) throw new Error('fetch не был вызван')
    const init = call[1]

    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      body: '{"mood":4}',
    })
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-CSRFToken': 'token-123',
    })
  })

  it('создаёт безопасный ApiError для HTTP-ошибки', async () => {
    stubFetch(jsonResponse(privateError, 400))
    const error = await api
      .post('/api/auth/register/', { username: 'taken' }, objectSchema)
      .catch((reason: unknown) => reason)

    expect(error).toMatchObject({ status: 400, code: 'validation_error' })
    expect('data' in (error as object)).toBe(false)
    expect(JSON.stringify(error)).not.toContain('private_note')
  })

  it('отличает сетевую ошибку от ответа сервера', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')))
    await expect(api.get('/api/config/', objectSchema)).rejects.toBeInstanceOf(NetworkError)
  })

  it('передаёт внешнюю отмену запроса', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Abort', 'AbortError')),
            )
          }),
      ),
    )
    const result = api
      .get('/api/config/', objectSchema, { signal: controller.signal })
      .catch((reason: unknown) => reason)
    controller.abort()

    await expect(result).resolves.toMatchObject({ name: 'AbortError' })
  })

  it('останавливает зависший запрос по тайм-ауту и очищает таймер', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Abort', 'AbortError')),
            )
          }),
      ),
    )
    const result = api
      .get('/api/config/', objectSchema, { timeoutMs: 25 })
      .catch((reason: unknown) => reason)
    await vi.advanceTimersByTimeAsync(25)

    await expect(result).resolves.toBeInstanceOf(RequestTimeoutError)
    expect(vi.getTimerCount()).toBe(0)
  })
})
