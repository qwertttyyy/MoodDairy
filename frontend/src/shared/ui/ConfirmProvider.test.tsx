import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { useConfirm } from './confirm'
import { ConfirmProvider } from './ConfirmProvider'

function Trigger({ action }: { action: () => Promise<void> }) {
  const confirm = useConfirm()
  return (
    <button
      type="button"
      onClick={() =>
        confirm({
          title: 'Удалить запись?',
          text: 'Действие нельзя отменить.',
          onConfirm: action,
        })
      }
    >
      Открыть
    </button>
  )
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

describe('ConfirmProvider', () => {
  it('блокирует повтор и закрытие до успеха асинхронного действия', async () => {
    const task = deferred()
    const action = vi.fn(() => task.promise)
    render(
      <ConfirmProvider>
        <Trigger action={action} />
      </ConfirmProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Открыть' }))
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(screen.getByRole('button', { name: 'Выполняется…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled()
    expect(action).toHaveBeenCalledTimes(1)

    task.resolve()
    await waitFor(() => expect(screen.queryByText('Удалить запись?')).not.toBeInTheDocument())
  })

  it('оставляет подтверждение открытым и показывает ошибку действия', async () => {
    const action = vi.fn().mockRejectedValue(new Error('Не удалось удалить запись'))
    render(
      <ConfirmProvider>
        <Trigger action={action} />
      </ConfirmProvider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Открыть' }))
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось удалить запись')
    expect(screen.getByText('Удалить запись?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeEnabled()
  })
})
