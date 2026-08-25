import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider } from '../../shared/ui/ConfirmProvider'
import { ToastProvider } from '../../shared/ui/ToastProvider'
import { GuideProvider } from '../guide/GuideProvider'
import { EntryModal } from './EntryModal'
import { useEntryModal } from './EntryModalContext'
import { EntryModalProvider } from './EntryModalProvider'
import type { DecryptedEntry } from './types'

const entry: DecryptedEntry = {
  kind: 'ready',
  id: 12,
  mood: 7,
  anxiety: 2,
  note: 'Заметка',
  tags: [],
  timestamp: '2026-08-24T20:00:00Z',
}

function OpenEditor() {
  const modal = useEntryModal()
  return (
    <button type="button" onClick={() => modal.open(entry)}>
      Открыть запись
    </button>
  )
}

function renderEditor(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  vi.stubGlobal('fetch', fetchMock)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>
          <EntryModalProvider>
            <GuideProvider>
              <OpenEditor />
              <EntryModal />
            </GuideProvider>
          </EntryModalProvider>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function confirmationButton(): HTMLButtonElement {
  const buttons = screen.getAllByRole('button', { name: 'Удалить' })
  const button = buttons.at(-1)
  if (!(button instanceof HTMLButtonElement)) throw new Error('Нет кнопки подтверждения')
  return button
}

afterEach(() => vi.unstubAllGlobals())

describe('удаление записи из редактора', () => {
  it('доступно с клавиатуры и не закрывает редактор до ответа сервера', async () => {
    let finishDelete!: () => void
    const deleteResponse = new Promise<Response>((resolve) => {
      finishDelete = () => resolve(new Response(null, { status: 204 }))
    })
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      if (init?.method === 'DELETE') return deleteResponse
      return new Response('[]')
    })
    renderEditor(fetchMock)

    await userEvent.click(screen.getByRole('button', { name: 'Открыть запись' }))
    const deleteButton = screen.getByRole('button', { name: 'Удалить' })
    deleteButton.focus()
    await userEvent.keyboard('{Enter}')
    confirmationButton().focus()
    await userEvent.keyboard('{Enter}')

    expect(screen.getByRole('heading', { name: 'Редактировать' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Выполняется…' })).toBeDisabled()
    finishDelete()
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/entries/12/', expect.anything()),
    )
    await waitFor(
      () =>
        expect(screen.queryByRole('heading', { name: 'Редактировать' })).not.toBeInTheDocument(),
      { timeout: 1_500 },
    )
  })

  it('при ошибке оставляет редактор и подтверждение открытыми', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      if (init?.method === 'DELETE') {
        return new Response(
          JSON.stringify({ error: { code: 'internal_error', message: 'Не удалось удалить' } }),
          { status: 500 },
        )
      }
      return new Response('[]')
    })
    renderEditor(fetchMock)

    await userEvent.click(screen.getByRole('button', { name: 'Открыть запись' }))
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    await userEvent.click(confirmationButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось удалить')
    expect(screen.getByRole('heading', { name: 'Редактировать' })).toBeInTheDocument()
    expect(screen.getByText('Удалить запись?')).toBeInTheDocument()
  })
})
