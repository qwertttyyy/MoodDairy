import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import {
  ApiError,
  ERROR_CODES,
  IncompatibleApiResponseError,
  NetworkError,
  RequestTimeoutError,
  api,
  isApiError,
  parseApiError,
  parseErrors,
  shouldRetry,
} from './client'
import { voidResponseSchema } from './types'

const FALLBACK = 'Произошла ошибка'
const objectSchema = z.object({ id: z.number() })

function envelope(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { error: { code, message, request_id: 'req-1', ...extra } }
}

describe('parseErrors', () => {
  it.each([
    ['строку', 'Сервис недоступен', 'Сервис недоступен'],
    ['HTML', '<html>502</html>', '<html>502</html>'],
    ['detail', { detail: 'Страница не найдена.' }, 'Страница не найдена.'],
    [
      'non_field_errors',
      { non_field_errors: ['Неверный логин.', 'Попробуйте снова.'] },
      'Неверный логин. Попробуйте снова.',
    ],
    ['поля', { username: ['занят'], password: ['коротко'] }, 'username: занят\npassword: коротко'],
    ['пустое значение', null, FALLBACK],
    ['пустой объект', {}, FALLBACK],
  ])('разбирает %s', (_name, value, expected) => {
    expect(parseErrors(value)).toBe(expected)
  })

  it('не превращает вложенные объекты в [object Object]', () => {
    expect(parseErrors({ detail: {}, nested: {} })).toBe(FALLBACK)
  })
})

describe('parseApiError', () => {
  it('читает стабильный конверт ошибки', () => {
    const payload = parseApiError(
      envelope('validation_error', 'Проверьте поля', {
        fields: { mood: ['Ожидается формат iv:ciphertext.'] },
      }),
    )
    expect(payload).toEqual({
      code: 'validation_error',
      message: 'Проверьте поля',
      fields: { mood: ['Ожидается формат iv:ciphertext.'] },
      requestId: 'req-1',
    })
  })

  it('сохраняет будущий код ошибки', () => {
    expect(parseApiError(envelope('future_code', 'Новая ошибка')).code).toBe('future_code')
  })

  it('использует безопасный fallback для чужого ответа', () => {
    expect(parseApiError({ error: { code: 'gone' } })).toMatchObject({
      code: ERROR_CODES.unknown,
      message: FALLBACK,
    })
  })
})

describe('ApiError и retry policy', () => {
  const payload = { code: 'gone', message: 'Ссылка отозвана', fields: {}, requestId: 'req-1' }

  it('не хранит приватное тело ответа', () => {
    const error = new ApiError(410, payload)
    expect(error).toMatchObject({ status: 410, code: 'gone', requestId: 'req-1' })
    expect('data' in error).toBe(false)
    expect(isApiError(error)).toBe(true)
  })

  it('повторяет только сеть, timeout и 5xx — не более одного раза', () => {
    expect(shouldRetry(0, new NetworkError(new TypeError()))).toBe(true)
    expect(shouldRetry(0, new RequestTimeoutError(20))).toBe(true)
    expect(shouldRetry(0, new ApiError(503, payload))).toBe(true)
    expect(shouldRetry(1, new ApiError(503, payload))).toBe(false)
    expect(shouldRetry(0, new ApiError(401, payload))).toBe(false)
    expect(shouldRetry(0, new IncompatibleApiResponseError([]))).toBe(false)
  })
})

describe('api', () => {
  function stubFetch(response: Response) {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(response)
    vi.stubGlobal('fetch', mock)
    return mock
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status })
  }

  function firstCall(
    mock: ReturnType<typeof stubFetch>,
  ): [RequestInfo | URL, RequestInit | undefined] {
    const call = mock.mock.calls[0]
    if (!call) throw new Error('fetch не был вызван')
    return [call[0], call[1]]
  }

  function headersOf(init: RequestInit | undefined): Record<string, string> {
    return (init?.headers ?? {}) as Record<string, string>
  }

  beforeEach(() => {
    document.cookie = 'csrftoken=token-123'
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  })

  it('валидирует успешный JSON и формирует GET', async () => {
    const mock = stubFetch(jsonResponse({ id: 7, ignored: 'совместимое поле' }))
    await expect(api.get('/api/entries/7/', objectSchema)).resolves.toEqual({ id: 7 })
    const [url, init] = firstCall(mock)
    expect(url).toBe('/api/entries/7/')
    expect(init?.method).toBe('GET')
    expect(init?.body).toBeUndefined()
  })

  it('отклоняет несовместимый успешный ответ без сохранения его данных', async () => {
    stubFetch(jsonResponse({ id: 'secret-invalid-value' }))
    const error = await api.get('/api/value/', objectSchema).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(IncompatibleApiResponseError)
    expect(JSON.stringify(error)).not.toContain('secret-invalid-value')
  })

  it('передаёт CSRF, credentials и JSON body', async () => {
    const mock = stubFetch(jsonResponse({ id: 1 }, 201))
    await api.post('/api/entries/', { mood: 4 }, objectSchema)
    const [, init] = firstCall(mock)
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('same-origin')
    expect(init?.body).toBe('{"mood":4}')
    expect(headersOf(init)).toMatchObject({
      'Content-Type': 'application/json',
      'X-CSRFToken': 'token-123',
    })
  })

  it('принимает пустой 204', async () => {
    stubFetch(new Response(null, { status: 204 }))
    await expect(api.del('/api/entries/1/', voidResponseSchema)).resolves.toBeUndefined()
  })

  it('на не-2xx бросает ApiError с полями, но без полного тела', async () => {
    const body = envelope('validation_error', 'Проверьте поля', {
      fields: { username: ['Имя пользователя занято.'] },
    })
    stubFetch(jsonResponse(body, 400))
    const error = await api
      .post('/api/auth/register/', { username: 'taken' }, objectSchema)
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 400,
      code: 'validation_error',
      fields: { username: ['Имя пользователя занято.'] },
    })
    expect('data' in (error as object)).toBe(false)
  })

  it('преобразует сбой fetch в NetworkError', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')))
    await expect(api.get('/api/config/', objectSchema)).rejects.toBeInstanceOf(NetworkError)
  })

  it('отменяет запрос по внешнему AbortSignal', async () => {
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
