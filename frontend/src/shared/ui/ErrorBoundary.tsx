import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  failed: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Дневниковые данные намеренно не отправляются во внешние системы и не логируются.
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="screen auth-screen">
        <div className="auth-card startup-card" role="alert">
          <h1 className="auth-title">Не удалось открыть приложение</h1>
          <p className="auth-sub">Перезагрузите страницу, чтобы начать заново.</p>
          <button type="button" className="btn-primary" onClick={() => location.reload()}>
            Перезагрузить
          </button>
        </div>
      </main>
    )
  }
}
