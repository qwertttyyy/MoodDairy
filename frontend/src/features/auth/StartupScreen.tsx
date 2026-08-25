import type { AuthStatus } from './AuthContext'
import { Spinner } from '../../shared/ui/Spinner'

interface StartupScreenProps {
  status: Extract<AuthStatus, 'loading' | 'offline' | 'server-unavailable' | 'invalid-config'>
  onRetry: () => void
}

const COPY = {
  offline: {
    title: 'Нет подключения к интернету',
    text: 'Приложение открылось, но для авторизации и дневниковых данных нужен интернет.',
  },
  'server-unavailable': {
    title: 'Сервер сейчас недоступен',
    text: 'Проверьте подключение и попробуйте ещё раз.',
  },
  'invalid-config': {
    title: 'Не удалось запустить приложение',
    text: 'Сервер вернул несовместимую конфигурацию. Попробуйте обновить страницу позже.',
  },
} as const

export function StartupScreen({ status, onRetry }: StartupScreenProps) {
  if (status === 'loading') {
    return (
      <main className="screen auth-screen" aria-busy="true">
        <div className="auth-card startup-card" role="status" aria-live="polite">
          <h1 className="auth-title">Moods</h1>
          <Spinner />
          <p className="auth-sub">Подготавливаем приложение…</p>
        </div>
      </main>
    )
  }

  const copy = COPY[status]
  return (
    <main className="screen auth-screen">
      <div className="auth-card startup-card" role="alert">
        <h1 className="auth-title">{copy.title}</h1>
        <p className="auth-sub">{copy.text}</p>
        <button type="button" className="btn-primary" onClick={onRetry}>
          Повторить
        </button>
      </div>
    </main>
  )
}
