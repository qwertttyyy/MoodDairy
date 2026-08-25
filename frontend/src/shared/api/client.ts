import type { ZodType } from 'zod'

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
  unknown: 'error',
} as const

export const REQUEST_TIMEOUTS = {
  bootstrap: 12_000,
  standard: 20_000,
  createShare: 60_000,
} as const

export type ErrorCode = string

export interface ApiErrorPayload {
  code: ErrorCode
  message: string
  fields: Record<string, string[]>
  requestId: string
}

export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Не удалось подключиться к серверу', { cause })
    this.name = 'NetworkError'
  }
}

export class RequestTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super('Сервер не ответил вовремя')
    this.name = 'RequestTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly fields: Record<string, string[]>
  readonly requestId: string

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message)
    this.name = 'ApiError'
    this.status = status
    this.code = payload.code
    this.fields = payload.fields
    this.requestId = payload.requestId
  }
}

export interface ResponseIssue {
  path: PropertyKey[]
  message: string
}

export class IncompatibleApiResponseError extends Error {
  readonly issues: ResponseIssue[]

  constructor(issues: ResponseIssue[]) {
    super('Сервер вернул ответ в неизвестном формате')
    this.name = 'IncompatibleApiResponseError'
    this.issues = issues
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

export function isRetryableError(error: unknown): boolean {
  return (
    error instanceof NetworkError ||
    error instanceof RequestTimeoutError ||
    (error instanceof ApiError && error.status >= 500 && error.status <= 599)
  )
}

/** TanStack Query делает не более одной повторной попытки только для временных сбоев. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && isRetryableError(error)
}

export interface RequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/)
  return match?.[1] ?? ''
}

async function request<T>(
  method: string,
  url: string,
  schema: ZodType<T>,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUTS.standard
  let timedOut = false

  const abortFromCaller = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true })

  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
      credentials: 'same-origin',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    })

    const text = await response.text()
    let data: unknown
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }

    if (!response.ok) throw new ApiError(response.status, parseApiError(data))

    const parsed = schema.safeParse(data)
    if (!parsed.success) {
      throw new IncompatibleApiResponseError(
        parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      )
    }
    return parsed.data
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError(timeoutMs)
    if (options.signal?.aborted) throw new DOMException('Запрос отменён', 'AbortError')
    if (error instanceof ApiError || error instanceof IncompatibleApiResponseError) throw error
    throw new NetworkError(error)
  } finally {
    window.clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}

export const api = {
  get: <T>(url: string, schema: ZodType<T>, options?: RequestOptions) =>
    request('GET', url, schema, undefined, options),
  post: <T>(url: string, body: unknown, schema: ZodType<T>, options?: RequestOptions) =>
    request('POST', url, schema, body, options),
  patch: <T>(url: string, body: unknown, schema: ZodType<T>, options?: RequestOptions) =>
    request('PATCH', url, schema, body, options),
  put: <T>(url: string, body: unknown, schema: ZodType<T>, options?: RequestOptions) =>
    request('PUT', url, schema, body, options),
  del: <T>(url: string, schema: ZodType<T>, options?: RequestOptions) =>
    request('DELETE', url, schema, undefined, options),
}

const FALLBACK_MESSAGE = 'Произошла ошибка'

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

const GENERAL_ERROR_KEYS = ['detail', 'non_field_errors']

export function parseErrors(data: unknown): string {
  if (typeof data === 'string') return data || FALLBACK_MESSAGE
  if (!data || typeof data !== 'object') return FALLBACK_MESSAGE

  const payload = data as Record<string, unknown>
  for (const key of GENERAL_ERROR_KEYS) {
    const message = toText(payload[key])
    if (message) return message
  }

  const messages = Object.entries(payload)
    .filter(([field]) => !GENERAL_ERROR_KEYS.includes(field))
    .map(([field, errors]) => [field, toText(errors)] as const)
    .filter(([, message]) => message !== '')
    .map(([field, message]) => `${field}: ${message}`)

  return messages.join('\n') || FALLBACK_MESSAGE
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(' ')
  if (typeof value === 'object') return ''
  return String(value as string | number | boolean | bigint | symbol)
}
