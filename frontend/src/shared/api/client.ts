/**
 * Обёртка над fetch для DRF-бэкенда.
 *
 * Сессионная аутентификация по cookie, CSRF-токен из cookie `csrftoken`
 * в заголовке `X-CSRFToken`, `credentials: same-origin`.
 *
 * Ошибки бэкенд отдаёт единым конвертом `{"error": {code, message, ...}}` —
 * контракт описан в docs/api-errors.md. Реагировать в коде нужно на `code`:
 * он стабилен, а `message` может меняться и переводиться. Ответы не от нашего
 * API (заглушка nginx, ошибка прокси) разбираются запасным путём.
 */

/** Машиночитаемые коды ошибок. Полный список — docs/api-errors.md. */
export const ERROR_CODES = {
  validationError: 'validation_error',
  invalidCredentials: 'invalid_credentials',
  notAuthenticated: 'not_authenticated',
  wrappingKeyMissing: 'wrapping_key_missing',
  csrfFailed: 'csrf_failed',
  permissionDenied: 'permission_denied',
  notFound: 'not_found',
  gone: 'gone',
  rateLimited: 'rate_limited',
  internalError: 'internal_error',
  /** Запасной код: ошибка не от нашего API либо код неизвестен клиенту. */
  unknown: 'error',
} as const

export type ErrorCode = string

/** Разобранное содержимое конверта ошибки. */
export interface ApiErrorPayload {
  code: ErrorCode
  message: string
  /** Ошибки по полям формы — только для `validation_error`. */
  fields: Record<string, string[]>
  /** Идентификатор запроса: по нему ошибку находят в логах сервера. */
  requestId: string
}

/**
 * Ошибка запроса.
 *
 * `status` нужен для ветвления по HTTP-семантике (401 — нет сессии),
 * `code` — для реакции на конкретную ошибку, `fields` — для подсветки формы.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly fields: Record<string, string[]>
  readonly requestId: string
  readonly data: unknown

  constructor(status: number, payload: ApiErrorPayload, data?: unknown) {
    super(payload.message)
    this.name = 'ApiError'
    this.status = status
    this.code = payload.code
    this.fields = payload.fields
    this.requestId = payload.requestId
    this.data = data
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/)
  return match ? match[1] : ''
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  // 204 и пустое тело — законный ответ (logout, delete), JSON.parse на нём падает.
  const text = await response.text()
  let data: unknown
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!response.ok) throw new ApiError(response.status, parseApiError(data), data)
  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
}

const FALLBACK_MESSAGE = 'Произошла ошибка'

/** Разбирает ответ об ошибке: сначала конверт бэкенда, затем запасной путь. */
export function parseApiError(data: unknown): ApiErrorPayload {
  return (
    readEnvelope(data) ?? {
      code: ERROR_CODES.unknown,
      message: parseErrors(data),
      fields: {},
      requestId: '',
    }
  )
}

/** Читает `{"error": {...}}`. Возвращает null, если это ответ не нашего API. */
function readEnvelope(data: unknown): ApiErrorPayload | null {
  if (!data || typeof data !== 'object') return null

  const error = (data as { error?: unknown }).error
  if (!error || typeof error !== 'object') return null

  const payload = error as Record<string, unknown>
  const message = typeof payload.message === 'string' ? payload.message : ''
  if (!message) return null

  return {
    code: typeof payload.code === 'string' ? payload.code : ERROR_CODES.unknown,
    message,
    fields: readFields(payload.fields),
    requestId: typeof payload.request_id === 'string' ? payload.request_id : '',
  }
}

/** Приводит `fields` к `{поле: [сообщения]}`, отбрасывая всё неожиданное. */
function readFields(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const result: Record<string, string[]> = {}
  for (const [field, messages] of Object.entries(value as Record<string, unknown>)) {
    const list = Array.isArray(messages) ? messages : [messages]
    const texts = list.map(String).filter((text) => text !== '')
    if (texts.length > 0) result[field] = texts
  }
  return result
}

/** Служебные ключи DRF: их текст показываем без имени поля. */
const GENERAL_ERROR_KEYS = ['detail', 'non_field_errors']

/**
 * Запасной разбор для ответов вне контракта: заглушки прокси, голый DRF.
 * Приводит что угодно к одной строке для пользователя.
 */
export function parseErrors(data: unknown): string {
  if (typeof data === 'string') return data || FALLBACK_MESSAGE
  if (!data || typeof data !== 'object') return FALLBACK_MESSAGE

  const payload = data as Record<string, unknown>

  for (const key of GENERAL_ERROR_KEYS) {
    const text = toText(payload[key])
    if (text) return text
  }

  // Пустые значения пропускаем: иначе в сообщении окажется имя поля без причины.
  const messages = Object.entries(payload)
    .filter(([field]) => !GENERAL_ERROR_KEYS.includes(field))
    .map(([field, errors]) => [field, toText(errors)] as const)
    .filter(([, text]) => text !== '')
    .map(([field, text]) => `${field}: ${text}`)

  return messages.join('\n') || FALLBACK_MESSAGE
}

/** Значение ошибки DRF (строка, число, массив строк) в одну строку. */
function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(' ')
  // Вложенный объект показать нечем: строка вида "[object Object]" хуже,
  // чем общий текст ошибки.
  if (typeof value === 'object') return ''
  return String(value as string | number | boolean | bigint | symbol)
}
