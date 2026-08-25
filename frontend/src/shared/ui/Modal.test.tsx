import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Modal, ModalCloseButton } from './Modal'

function ModalHarness() {
  const [open, setOpen] = useState(false)
  const safeButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Открыть окно
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        titleId="test-modal-title"
        initialFocusRef={safeButtonRef}
      >
        <h2 id="test-modal-title">Проверка окна</h2>
        <button ref={safeButtonRef} type="button">
          Безопасное действие
        </button>
        <ModalCloseButton onClick={() => setOpen(false)} />
      </Modal>
    </>
  )
}

describe('Modal', () => {
  it('связывает заголовок, ставит начальный фокус и возвращает его после закрытия', async () => {
    await userEvent
      .setup()
      .click(render(<ModalHarness />).getByRole('button', { name: 'Открыть окно' }))

    const dialog = screen.getByRole('dialog', { name: 'Проверка окна' })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Безопасное действие' })).toHaveFocus(),
    )

    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Открыть окно' })).toHaveFocus()
  })

  it('закрывается управляемым кликом по фону', async () => {
    render(<ModalHarness />)
    await userEvent.click(screen.getByRole('button', { name: 'Открыть окно' }))

    const dialog = screen.getByRole('dialog', { name: 'Проверка окна' })
    fireEvent.click(dialog)
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })
})
