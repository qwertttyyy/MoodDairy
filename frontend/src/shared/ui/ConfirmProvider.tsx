import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'

import { Modal } from './Modal'

export interface ConfirmRequest {
  title: string
  text: string
  onConfirm: () => void
  /** Подпись кнопки подтверждения. По умолчанию — «Удалить». */
  confirmLabel?: string
}

const DEFAULT_CONFIRM_LABEL = 'Удалить'

type Confirm = (request: ConfirmRequest) => void

const ConfirmContext = createContext<Confirm | null>(null)

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm должен вызываться внутри ConfirmProvider')
  return confirm
}

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
