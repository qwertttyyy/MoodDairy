/**
 * Обёртка над fetch для DRF-бэкенда.
 *
 * Порт модуля `Api` из backend/static/app.js: сессионная аутентификация по cookie,
 * CSRF-токен из cookie `csrftoken` в заголовке `X-CSRFToken`, `credentials: same-origin`.
 * Ошибки приводятся к человекочитаемому тексту и выбрасываются как ApiError.
 */

/** Ошибка запроса. `status` нужен вызывающему коду: 401 — нет сессии, 410 — ссылка отозвана. */
export class ApiError extends Error {
  readonly status: number
  readonly data: unknown

  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
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

  if (!response.ok) throw new ApiError(response.status, parseErrors(data), data)
  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
}

/** Служебные ключи DRF: их текст показываем без имени поля. */
const GENERAL_ERROR_KEYS = ['detail', 'non_field_errors']

/** Приводит ответ DRF об ошибке к одной строке. */
export function parseErrors(data: unknown): string {
  const fallback = 'Произошла ошибка'
  if (typeof data === 'string') return data || fallback
  if (!data || typeof data !== 'object') return fallback

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

  return messages.join('\n') || fallback
}

/** Значение ошибки DRF (строка, число, массив строк) в одну строку. */
function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(' ')
  return String(value)
}
