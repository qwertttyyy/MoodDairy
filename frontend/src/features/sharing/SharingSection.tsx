import { useState } from 'react'

import { useConfirm } from '../../shared/ui/ConfirmProvider'
import { useToast } from '../../shared/ui/ToastProvider'
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
 * Блок «Доступ для врача» внутри группы настроек.
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
      onError: () => toast('Ошибка при создании ссылки', true),
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
      icon: '🔗',
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

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="setting-label">Доступ для врача</span>
        <button className="btn-sm-accent" onClick={handleCreate} disabled={createShare.isPending}>
          {createShare.isPending ? 'Загрузка…' : 'Создать ссылку'}
        </button>
      </div>

      {boxVisible && (
        <div className="share-link-box">
          <div className="share-link-display">
            <input
              type="text"
              className="glass-input share-link-input"
              readOnly
              value={fullUrl ?? HIDDEN_LINK_TEXT}
              style={{ fontSize: fullUrl ? undefined : '0.7rem' }}
            />
            <button className="btn-icon-glass" aria-label="Копировать" onClick={handleCopy}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            </button>
          </div>
          <button
            className="btn-sm-danger"
            style={{ marginTop: 8, width: '100%' }}
            onClick={handleRevoke}
          >
            Отозвать ссылку
          </button>
        </div>
      )}
    </>
  )
}
