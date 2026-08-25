import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'

import { ConfirmContext } from './confirm'
import type { Confirm, ConfirmRequest } from './confirm'
import { Modal } from './Modal'

const DEFAULT_CONFIRM_LABEL = 'Удалить'

/** Диалог подтверждения: разметка из старого фронта, подпись действия задаёт вызывающий код. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)

  const confirm = useCallback<Confirm>((next) => setRequest(next), [])
  const close = useCallback(() => setRequest(null), [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={request !== null} onClose={close} className="modal-sm">
        <div className="modal-body">
          <h3>{request?.title}</h3>
          <p>{request?.text}</p>
        </div>
        <div className="modal-footer modal-footer-split">
          <button className="btn-secondary" onClick={close}>
            Отмена
          </button>
          <button
            className="btn-danger"
            onClick={() => {
              request?.onConfirm()
              close()
            }}
          >
            {request?.confirmLabel ?? DEFAULT_CONFIRM_LABEL}
          </button>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  )
}
