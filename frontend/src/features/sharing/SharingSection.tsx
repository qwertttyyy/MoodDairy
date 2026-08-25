import { useState } from 'react'

import { useConfirm } from '../../shared/ui/confirm'
import { ErrorState } from '../../shared/ui/QueryState'
import { useToast } from '../../shared/ui/toast'
import { buildShareUrl, useCreateShare, useRevokeShare, useSharingStatus } from './api'
import type { CreatedShare } from './api'

/** Заглушка вместо ссылки, ключ которой уже не известен клиенту. */
const HIDDEN_LINK_TEXT = '🔒 Полная ссылка была показана при создании'

/**
 * Полная ссылка либо null, когда показать её нечем.
 *
 * Ключ есть только у ссылки, созданной в этой вкладке: на сервере лежит один шифротекст.
 * Ссылке без шифрования ключ не нужен, поэтому её URL полон и после перезагрузки.
 */
function resolveShareUrl(
  created: CreatedShare | null,
  serverShare: { token: string; is_encrypted: boolean } | null,
): string | null {
  if (created) return buildShareUrl(created.token, created.shareKeyB64)
  if (serverShare && !serverShare.is_encrypted) return buildShareUrl(serverShare.token, '')
  return null
}

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

  const handleCreate = () => {
    createShare.mutate(undefined, {
      onSuccess: (share) => {
        setCreated(share)
        toast('Ссылка создана')
      },
      onError: (error) =>
        toast(error instanceof Error ? error.message : 'Ошибка при создании ссылки', true),
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
      onConfirm: () =>
        revokeShare.mutate(undefined, {
          onSuccess: () => {
            setCreated(null)
            toast('Ссылка отозвана')
          },
          onError: () => toast('Ошибка', true),
        }),
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
            {status.isPending || createShare.isPending ? 'Загрузка…' : 'Создать ссылку'}
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
              <button className="btn-plain" onClick={handleCopy}>
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
