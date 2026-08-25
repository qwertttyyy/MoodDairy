/**
 * Тесты API-клиента.
 *
 * Главное здесь — разбор ошибок. Бэкенд отдаёт единый конверт
 * `{"error": {code, message, fields, request_id}}` (docs/api-errors.md);
 * parseErrors остаётся запасным путём для ответов вне контракта.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, ERROR_CODES, api, isApiError, parseApiError, parseErrors } from './client'

const FALLBACK = 'Произошла ошибка'

/** Конверт ошибки в том виде, в каком его отдаёт бэкенд. */
function envelope(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { error: { code, message, request_id: 'req-1', ...extra } }
}

describe('parseErrors', () => {
  describe('строка на входе', () => {
    it('возвращает строку как есть', () => {
      expect(parseErrors('Сервис недоступен')).toBe('Сервис недоступен')
    })

    it('пустую строку заменяет на общий текст', () => {
      expect(parseErrors('')).toBe(FALLBACK)
    })

    it('возвращает как есть даже HTML-заглушку nginx (не JSON-ответ)', () => {
      expect(parseErrors('<html>502</html>')).toBe('<html>502</html>')
    })
  })

  describe('поле detail', () => {
    it('берёт detail', () => {
      expect(parseErrors({ detail: 'Страница не найдена.' })).toBe('Страница не найдена.')
    })

    it('приводит нестроковый detail к строке', () => {
      expect(parseErrors({ detail: 42 })).toBe('42')
    })

    it('пустой detail даёт общий текст, а не имя поля', () => {
      expect(parseErrors({ detail: '' })).toBe('Произошла ошибка')
    })

    it('detail имеет приоритет над остальными полями', () => {
      const data = { detail: 'Нет доступа', non_field_errors: ['Игнор'], username: ['Игнор'] }
      expect(parseErrors(data)).toBe('Нет доступа')
    })
  })

  describe('поле non_field_errors', () => {
    it('склеивает несколько сообщений через пробел', () => {
      const data = { non_field_errors: ['Неверный логин.', 'Попробуйте снова.'] }
      expect(parseErrors(data)).toBe('Неверный логин. Попробуйте снова.')
    })

    it('работает на одном сообщении', () => {
      expect(parseErrors({ non_field_errors: ['Неверный пароль.'] })).toBe('Неверный пароль.')
    })

    it('имеет приоритет над полевыми ошибками', () => {
      const data = { non_field_errors: ['Общая ошибка'], username: ['Занят'] }
      expect(parseErrors(data)).toBe('Общая ошибка')
    })

    it('пустой массив даёт общий текст, а не пустое сообщение', () => {
      expect(parseErrors({ non_field_errors: [] })).toBe('Произошла ошибка')
    })

    it('пустой non_field_errors не мешает показать полевые ошибки', () => {
      const data = { non_field_errors: [], username: ['Занят'] }
      expect(parseErrors(data)).toBe('username: Занят')
    })
  })

  describe('полевые ошибки', () => {
    it('перечисляет поля через перевод строки в формате «поле: текст»', () => {
      const data = { username: ['занят'], password: ['коротко'] }
      expect(parseErrors(data)).toBe('username: занят\npassword: коротко')
    })

    it('склеивает несколько ошибок одного поля через пробел', () => {
      const data = { password: ['Слишком короткий.', 'Только цифры.'] }
      expect(parseErrors(data)).toBe('password: Слишком короткий. Только цифры.')
    })

    it('принимает не-массив в значении поля', () => {
      expect(parseErrors({ username: 'занят' })).toBe('username: занят')
    })
  })

  describe('неизвестная и пустая форма', () => {
    const shapes: Array<[string, unknown]> = [
      ['null', null],
      ['undefined', undefined],
      ['число', 42],
      ['пустой объект', {}],
      ['пустой массив', []],
      ['false', false],
    ]

    it.each(shapes)('%s даёт общий текст', (_name, value) => {
      expect(parseErrors(value)).toBe(FALLBACK)
    })
  })
})

describe('parseApiError', () => {
  it('читает код, сообщение и request_id из конверта', () => {
    const payload = parseApiError(envelope('gone', 'Ссылка недействительна.'))

    expect(payload.code).toBe(ERROR_CODES.gone)
    expect(payload.message).toBe('Ссылка недействительна.')
    expect(payload.requestId).toBe('req-1')
  })

  it('читает ошибки по полям', () => {
    const payload = parseApiError(
      envelope('validation_error', 'Проверьте поля', {
        fields: { mood: ['Ожидается формат iv:ciphertext.'] },
      }),
    )

    expect(payload.fields).toEqual({ mood: ['Ожидается формат iv:ciphertext.'] })
  })

  it('приводит нестроковые значения полей к массиву строк', () => {
    const payload = parseApiError(envelope('validation_error', 'Ошибка', { fields: { year: 42 } }))

    expect(payload.fields).toEqual({ year: ['42'] })
  })

  it('без fields отдаёт пустой объект, а не undefined', () => {
    expect(parseApiError(envelope('not_found', 'Не найдено')).fields).toEqual({})
  })

  it('незнакомый код сохраняется как есть — фронт не должен ломаться', () => {
    const payload = parseApiError(envelope('some_future_code', 'Новая ошибка'))

    expect(payload.code).toBe('some_future_code')
    expect(payload.message).toBe('Новая ошибка')
  })

  describe('ответы вне контракта', () => {
    it('HTML-заглушка прокси отдаёт запасной код и её текст', () => {
      const payload = parseApiError('<html>502</html>')

      expect(payload.code).toBe(ERROR_CODES.unknown)
      expect(payload.message).toBe('<html>502</html>')
    })

    it('голый ответ DRF разбирается запасным путём', () => {
      const payload = parseApiError({ detail: 'Страница не найдена.' })

      expect(payload.code).toBe(ERROR_CODES.unknown)
      expect(payload.message).toBe('Страница не найдена.')
    })

    it('конверт без message считается чужим ответом', () => {
      const payload = parseApiError({ error: { code: 'gone' } })

      expect(payload.code).toBe(ERROR_CODES.unknown)
      expect(payload.message).toBe(FALLBACK)
    })

    it('пустое тело даёт общий текст', () => {
      expect(parseApiError(undefined).message).toBe(FALLBACK)
    })
  })
})

describe('ApiError', () => {
  const payload = {
    code: ERROR_CODES.gone,
    message: 'Ссылка отозвана',
    fields: {},
    requestId: 'req-1',
  }

  it('несёт status, code, message, requestId и data', () => {
    const data = envelope('gone', 'Ссылка отозвана')
    const error = new ApiError(410, payload, data)

    expect(error.status).toBe(410)
    expect(error.code).toBe(ERROR_CODES.gone)
    expect(error.message).toBe('Ссылка отозвана')
    expect(error.requestId).toBe('req-1')
    expect(error.data).toBe(data)
  })

  it('является настоящим Error с именем ApiError', () => {
    const error = new ApiError(401, payload)

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.name).toBe('ApiError')
    expect(String(error)).toContain('Ссылка отозвана')
  })

  it('isApiError отличает её от обычной ошибки', () => {
    expect(isApiError(new ApiError(500, payload))).toBe(true)
    expect(isApiError(new Error('обычная'))).toBe(false)
    expect(isApiError('строка')).toBe(false)
  })

  it('без data оставляет её undefined', () => {
    expect(new ApiError(500, payload).data).toBeUndefined()
  })
})

describe('api', () => {
  /** Подменяет fetch заранее заданным ответом и возвращает мок для проверки запроса. */
  function stubFetch(response: Response) {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(response)
    vi.stubGlobal('fetch', mock)
    return mock
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status })
  }

  /** Клиент передаёт headers обычным объектом — сужаем тип HeadersInit для проверок. */
  function headersOf(init: RequestInit | undefined): Record<string, string> {
    return (init?.headers ?? {}) as Record<string, string>
  }

  beforeEach(() => {
    document.cookie = 'csrftoken=token-123'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  })

  it('GET разбирает JSON-ответ', async () => {
    const mock = stubFetch(jsonResponse({ id: 7 }))

    await expect(api.get<{ id: number }>('/api/entries/7/')).resolves.toEqual({ id: 7 })
    expect(mock).toHaveBeenCalledTimes(1)
    expect(mock.mock.calls[0][0]).toBe('/api/entries/7/')
    expect(mock.mock.calls[0][1]?.method).toBe('GET')
    expect(mock.mock.calls[0][1]?.body).toBeUndefined()
  })

  it('передаёт CSRF-токен из cookie, JSON-заголовок и same-origin', async () => {
    const mock = stubFetch(jsonResponse({}))

    await api.get('/api/config/')

    const init = mock.mock.calls[0][1]
    expect(init?.credentials).toBe('same-origin')
    expect(headersOf(init)).toMatchObject({
      'Content-Type': 'application/json',
      'X-CSRFToken': 'token-123',
    })
  })

  it('POST сериализует тело в JSON', async () => {
    const mock = stubFetch(jsonResponse({ ok: true }, 201))

    await api.post('/api/entries/', { mood: 4 })

    expect(mock.mock.calls[0][1]?.method).toBe('POST')
    expect(mock.mock.calls[0][1]?.body).toBe('{"mood":4}')
  })

  it('PUT и DELETE используют свои методы', async () => {
    const put = stubFetch(jsonResponse({}))
    await api.put('/api/entries/1/', { mood: 1 })
    expect(put.mock.calls[0][1]?.method).toBe('PUT')

    const del = stubFetch(new Response(null, { status: 204 }))
    await api.del('/api/entries/1/')
    expect(del.mock.calls[0][1]?.method).toBe('DELETE')
    expect(del.mock.calls[0][1]?.body).toBeUndefined()
  })

  it('пустое тело (204 на logout/delete) не ломает разбор', async () => {
    stubFetch(new Response(null, { status: 204 }))
    await expect(api.del('/api/entries/1/')).resolves.toBeUndefined()
  })

  it('не-JSON тело отдаёт как строку', async () => {
    stubFetch(new Response('<html>ok</html>', { status: 200 }))
    await expect(api.get('/api/ping/')).resolves.toBe('<html>ok</html>')
  })

  it('на не-2xx бросает ApiError с кодом и текстом из конверта', async () => {
    const body = envelope('invalid_credentials', 'Неверный логин или пароль.')
    stubFetch(jsonResponse(body, 400))

    const error = await api.post('/api/auth/login/', { username: 'u' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(400)
    expect(apiError.code).toBe(ERROR_CODES.invalidCredentials)
    expect(apiError.message).toBe('Неверный логин или пароль.')
    expect(apiError.data).toEqual(body)
  })

  it('ошибка валидации доносит поля до формы', async () => {
    const body = envelope('validation_error', 'Проверьте правильность заполнения полей', {
      fields: { username: ['Имя пользователя занято.'] },
    })
    stubFetch(jsonResponse(body, 400))

    const error = await api
      .post('/api/auth/register/', { username: 'taken' })
      .catch((e: unknown) => e)

    expect((error as ApiError).fields).toEqual({ username: ['Имя пользователя занято.'] })
  })

  it('PATCH сериализует тело в JSON', async () => {
    const mock = stubFetch(jsonResponse({ id: 1, name: 'Отдых' }))

    await api.patch('/api/tags/1/', { name: 'Отдых' })

    expect(mock.mock.calls[0][1]?.method).toBe('PATCH')
    expect(mock.mock.calls[0][1]?.body).toBe('{"name":"Отдых"}')
  })

  it('на 401 без тела бросает ApiError с общим текстом', async () => {
    stubFetch(new Response(null, { status: 401 }))

    const error = await api.get('/api/me/').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(401)
    expect((error as ApiError).message).toBe(FALLBACK)
  })

  it('без cookie csrftoken отправляет пустой заголовок, а не undefined', async () => {
    document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    const mock = stubFetch(jsonResponse({}))

    await api.get('/api/config/')

    expect(headersOf(mock.mock.calls[0][1])).toMatchObject({ 'X-CSRFToken': '' })
  })
})
