import { Spinner } from './Spinner'

export function LoadingState({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="query-state" role="status" aria-live="polite" aria-busy="true">
      <Spinner />
      <span>{label}</span>
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="query-state query-error" role="alert">
      <p>{message}</p>
      <button type="button" className="btn-secondary" onClick={onRetry}>
        Повторить
      </button>
    </div>
  )
}
