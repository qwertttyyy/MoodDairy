import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <main className="screen auth-screen">
      <div className="auth-card startup-card" role="alert">
        <h1 className="auth-title">Страница не найдена</h1>
        <p className="auth-sub">Проверьте адрес или вернитесь на главную страницу.</p>
        <Link className="btn-primary" to="/">
          На главную
        </Link>
      </div>
    </main>
  )
}
