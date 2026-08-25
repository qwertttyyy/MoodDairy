import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { ConfirmContext } from './confirm'
import type { Confirm, ConfirmRequest } from './confirm'
import { Modal } from './Modal'

const DEFAULT_CONFIRM_LABEL = 'Удалить'

/** Диалог подтверждения: разметка из старого фронта, подпись действия задаёт вызывающий код. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const cancelRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback<Confirm>((next) => {
    setError('')
    setPending(false)
    setRequest(next)
  }, [])
  const close = useCallback(() => {
    if (!pending) setRequest(null)
  }, [pending])

  const runAction = async () => {
    if (!request || pending) return
    setPending(true)
    setError('')
    try {
      await request.onConfirm()
      setRequest(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось выполнить действие')
    } finally {
      setPending(false)
    }
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={request !== null}
        onClose={close}
        titleId="confirm-title"
        initialFocusRef={cancelRef}
        closeDisabled={pending}
        className="modal-sm"
      >
        <div className="modal-body">
          <h2 id="confirm-title">{request?.title}</h2>
          <p>{request?.text}</p>
          {error ? (
            <p className="confirm-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="modal-footer modal-footer-split">
          <button ref={cancelRef} className="btn-secondary" onClick={close} disabled={pending}>
            Отмена
          </button>
          <button
            className="btn-danger"
            onClick={() => void runAction()}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? 'Выполняется…' : (request?.confirmLabel ?? DEFAULT_CONFIRM_LABEL)}
          </button>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  )
}
