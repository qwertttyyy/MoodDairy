import { useState } from 'react'

import { useConfirm } from '../../shared/ui/confirm'
import { ErrorState } from '../../shared/ui/QueryState'
import { useToast } from '../../shared/ui/toast'
import { useCreateShare, useRevokeShare, useSharingStatus } from './api'
import type { CreatedShare } from './api'
import { HIDDEN_LINK_TEXT, resolveShareUrl } from './shareLink'

/**
 * Блок «Доступ для врача»: группа настроек и пояснение под ней.
 *
 * Одноразовый ключ ссылки живёт только в этом состоянии и в #-фрагменте URL.
 * После перезагрузки страницы его взять негде: сервер хранит лишь шифротекст,
 * поэтому для «старой» ссылки в поле показывается заглушка, а не URL без ключа.
 */
export function SharingSection() {
  const toast = useToast()
  const confirm = useConfirm()
  const status = useSharingStatus()
  const createShare = useCreateShare()
  const revokeShare = useRevokeShare()
  const [created, setCreated] = useState<CreatedShare | null>(null)

  const serverShare = status.data?.active ? status.data : null
  const fullUrl = resolveShareUrl(created, serverShare)
  const boxVisible = created !== null || serverShare !== null

  const createNewShare = async () => {
    const share = await createShare.mutateAsync()
    setCreated(share)
    toast(serverShare ? 'Ссылка заменена' : 'Ссылка создана')
  }

  const handleCreate = () => {
    if (serverShare) {
      confirm({
        title: 'Создать новую ссылку?',
        text: 'Старая ссылка сразу перестанет работать.',
        confirmLabel: 'Заменить',
        onConfirm: createNewShare,
      })
      return
    }
    void createNewShare().catch((error: unknown) => {
      toast(error instanceof Error ? error.message : 'Ошибка при создании ссылки', true)
    })
  }

  const handleCopy = () => {
    if (!fullUrl) return
    navigator.clipboard.writeText(fullUrl).then(
      () => toast('Ссылка скопирована'),
      () => toast('Не удалось скопировать', true),
    )
  }

  const handleRevoke = () => {
    confirm({
      title: 'Отозвать ссылку?',
      text: 'Врач потеряет доступ к данным.',
      confirmLabel: 'Отозвать',
      onConfirm: async () => {
        await revokeShare.mutateAsync()
        setCreated(null)
        toast('Ссылка отозвана')
      },
    })
  }

  if (status.error) {
    return (
      <ErrorState
        message="Не удалось загрузить настройки общего доступа"
        onRetry={() => void status.refetch()}
      />
    )
  }

  return (
    <>
      <div className="settings-group">
        <div className="set-row">
          <span className="set-label">Ссылка на дневник</span>
          <button
            className="btn-plain"
            onClick={handleCreate}
            disabled={status.isPending || createShare.isPending}
          >
            {status.isPending || createShare.isPending
              ? 'Загрузка…'
              : boxVisible
                ? 'Создать новую ссылку'
                : 'Создать ссылку'}
          </button>
        </div>

        {boxVisible && (
          <>
            <div className="set-sep" />
            <div className="set-row share-row">
              <input
                type="text"
                className="share-input"
                readOnly
                value={fullUrl ?? HIDDEN_LINK_TEXT}
              />
              <button className="btn-plain" onClick={handleCopy} disabled={!fullUrl}>
                Копировать
              </button>
            </div>
            <div className="set-sep" />
            <div className="set-row">
              <span className="set-label">Закрыть доступ</span>
              <button className="btn-plain btn-plain-danger" onClick={handleRevoke}>
                Отозвать
              </button>
            </div>
          </>
        )}
      </div>

      <p className="settings-note">
        Врач увидит записи только для чтения. Ключ ссылки хранится в её адресе — покажите её целиком
        сразу после создания.
      </p>
    </>
  )
}
