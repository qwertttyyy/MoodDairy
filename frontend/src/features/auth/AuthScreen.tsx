import { useState } from 'react'
import type { FormEvent } from 'react'

import { useAuth } from './AuthProvider'

/** Режим экрана: вход в существующий аккаунт или регистрация нового. */
type AuthMode = 'login' | 'register'

const MIN_PASSWORD_LENGTH = 8

/**
 * Экран входа и регистрации.
 *
 * Порт модуля `Auth` из старого app.js: те же тексты, те же проверки до запроса.
 * Сетевая часть и ключ шифрования — в AuthProvider.
 */
export function AuthScreen() {
  const { login, register } = useAuth()
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
    <div className="screen auth-screen">
      <div className="auth-card liquid-glass">
        <h1 className="auth-title">Moods</h1>
        <p className="auth-sub">Войди или создай аккаунт</p>

        <div className="auth-tabs">
          <button
            type="button"
            className={isRegister ? 'auth-tab' : 'auth-tab active'}
            onClick={() => switchMode('login')}
          >
            Вход
          </button>
          <button
            type="button"
            className={isRegister ? 'auth-tab active' : 'auth-tab'}
            onClick={() => switchMode('register')}
          >
            Регистрация
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="field-group">
            <label className="field-label" htmlFor="auth-username">
              Логин
            </label>
            <input
              type="text"
              id="auth-username"
              className="glass-input"
              placeholder="Имя пользователя"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="auth-password">
              Пароль
            </label>
            <input
              type="password"
              id="auth-password"
              className="glass-input"
              placeholder={isRegister ? 'Минимум 8 символов' : 'Пароль'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          {/* Блокировка на время запроса: деривация ключа занимает ~секунду, второй клик отправил бы дубль. */}
          <button type="submit" className="btn-primary" disabled={pending}>
            {isRegister ? 'Зарегистрироваться' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  )
}
