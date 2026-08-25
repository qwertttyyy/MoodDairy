import { useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

import { useAuth } from './AuthContext'

import './auth.css'

/** Режим экрана: вход в существующий аккаунт или регистрация нового. */
type AuthMode = 'login' | 'register'

const MIN_PASSWORD_LENGTH = 8
const AUTH_MODES: AuthMode[] = ['login', 'register']

/**
 * Экран входа и регистрации.
 *
 * Порт модуля `Auth` из старого app.js: те же тексты, те же проверки до запроса.
 * Сетевая часть и ключ шифрования — в AuthProvider.
 */
export function AuthScreen() {
  const { login, register, sessionMessage } = useAuth()
  const [mode, setMode] = useState<AuthMode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const isRegister = mode === 'register'

  const switchMode = (next: AuthMode) => {
    setMode(next)
    setError('')
  }

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (index + direction + AUTH_MODES.length) % AUTH_MODES.length
    const next = AUTH_MODES[nextIndex]
    if (!next) return
    switchMode(next)
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      .item(nextIndex)
      .focus()
  }

  /** Проверки до запроса. Возвращает текст ошибки или пустую строку. */
  const validate = (): string => {
    if (!username.trim()) return 'Введите логин'
    if (!password) return 'Введите пароль'
    if (isRegister && password.length < MIN_PASSWORD_LENGTH) return 'Пароль минимум 8 символов'
    return ''
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const validationError = validate()
    setError(validationError)
    if (validationError) return

    setPending(true)
    try {
      const submit = isRegister ? register : login
      await submit(username.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Произошла ошибка')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="screen auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Moods</h1>
        <p className="auth-sub">Войди или создай аккаунт</p>
        {sessionMessage ? (
          <p className="auth-session-message" role="status">
            {sessionMessage}
          </p>
        ) : null}

        <div className="auth-tabs" role="tablist" aria-label="Способ входа">
          {AUTH_MODES.map((item, index) => {
            const selected = item === mode
            return (
              <button
                key={item}
                type="button"
                id={`auth-tab-${item}`}
                role="tab"
                aria-selected={selected}
                aria-controls="auth-panel"
                tabIndex={selected ? 0 : -1}
                className={selected ? 'auth-tab active' : 'auth-tab'}
                onClick={() => switchMode(item)}
                onKeyDown={(event) => handleTabKey(event, index)}
              >
                {item === 'login' ? 'Вход' : 'Регистрация'}
              </button>
            )
          })}
        </div>

        <form
          className="auth-form"
          id="auth-panel"
          role="tabpanel"
          aria-labelledby={`auth-tab-${mode}`}
          aria-busy={pending}
          onSubmit={handleSubmit}
        >
          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-username">
              Логин
            </label>
            <input
              type="text"
              id="auth-username"
              className="glass-input auth-input"
              placeholder="Имя пользователя"
              autoComplete="username"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'auth-error' : undefined}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="auth-password">
              Пароль
            </label>
            <input
              type="password"
              id="auth-password"
              className="glass-input auth-input"
              placeholder={isRegister ? 'Минимум 8 символов' : 'Пароль'}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'auth-error' : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error && (
            <div className="auth-error" id="auth-error" role="alert">
              {error}
            </div>
          )}

          {/* Блокировка на время запроса: деривация ключа занимает ~секунду, второй клик отправил бы дубль. */}
          <button type="submit" className="btn-primary" disabled={pending} aria-busy={pending}>
            {pending ? 'Подождите…' : isRegister ? 'Зарегистрироваться' : 'Войти'}
          </button>
        </form>
      </div>
    </main>
  )
}
