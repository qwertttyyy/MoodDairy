/**
 * Управление тегами внутри настроек.
 *
 * Теги принадлежат пользователю: раньше их набор был общим и правился только
 * через админку. Удаление тега записи не трогает — пропадает лишь его связь
 * с ними, поэтому подтверждение объясняет именно это.
 */

import { useState } from 'react'

import { isApiError } from '../../shared/api/client'
import type { Tag } from '../../shared/api/types'
import { useConfirm } from '../../shared/ui/ConfirmProvider'
import { useToast } from '../../shared/ui/ToastProvider'
import { useCreateTag, useDeleteTag, useRenameTag, useTags } from './api'

const MAX_TAG_LENGTH = 50

/** Текст ошибки от сервера: у валидации он лежит в поле, иначе — общий. */
function errorText(error: unknown, fallback: string): string {
  if (!isApiError(error)) return fallback
  return error.fields.name?.[0] ?? error.message ?? fallback
}

export function TagsSection() {
  const toast = useToast()
  const confirm = useConfirm()
  const { data: tags = [], isPending } = useTags()
  const createTag = useCreateTag()
  const renameTag = useRenameTag()
  const deleteTag = useDeleteTag()

  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')

  const handleCreate = () => {
    const name = newName.trim()
    if (!name) return

    createTag.mutate(name, {
      onSuccess: () => {
        setNewName('')
        toast('Тег добавлен')
      },
      onError: (error) => toast(errorText(error, 'Не удалось добавить тег'), true),
    })
  }

  const startEditing = (tag: Tag) => {
    setEditingId(tag.id)
    setEditingName(tag.name)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditingName('')
  }

  const handleRename = (tag: Tag) => {
    const name = editingName.trim()
    if (!name || name === tag.name) {
      cancelEditing()
      return
    }

    renameTag.mutate(
      { id: tag.id, name },
      {
        onSuccess: () => {
          cancelEditing()
          toast('Тег переименован')
        },
        onError: (error) => toast(errorText(error, 'Не удалось переименовать'), true),
      },
    )
  }

  const handleDelete = (tag: Tag) => {
    confirm({
      title: `Удалить тег «${tag.name}»?`,
      text: 'Записи сохранятся — тег просто исчезнет из их списка.',
      confirmLabel: 'Удалить',
      icon: '🏷️',
      onConfirm: () =>
        deleteTag.mutate(tag.id, {
          onSuccess: () => toast('Тег удалён'),
          onError: () => toast('Не удалось удалить тег', true),
        }),
    })
  }

  return (
    <>
      <span className="setting-label">Теги</span>

      {isPending && <p className="setting-hint">Загрузка…</p>}

      {!isPending && tags.length === 0 && (
        <p className="setting-hint">Пока нет ни одного тега</p>
      )}

      <div className="tags-manager">
        {tags.map((tag) =>
          editingId === tag.id ? (
            <div className="tag-row" key={tag.id}>
              <input
                type="text"
                className="glass-input"
                value={editingName}
                maxLength={MAX_TAG_LENGTH}
                autoFocus
                onChange={(event) => setEditingName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleRename(tag)
                  if (event.key === 'Escape') cancelEditing()
                }}
              />
              <button
                className="btn-sm-accent"
                disabled={renameTag.isPending}
                onClick={() => handleRename(tag)}
              >
                ОК
              </button>
              <button className="btn-sm" onClick={cancelEditing}>
                Отмена
              </button>
            </div>
          ) : (
            <div className="tag-row" key={tag.id}>
              <span className="tag-name">{tag.name}</span>
              <button className="btn-sm" onClick={() => startEditing(tag)}>
                Изменить
              </button>
              <button className="btn-sm-danger" onClick={() => handleDelete(tag)}>
                Удалить
              </button>
            </div>
          ),
        )}
      </div>

      <div className="tag-row">
        <input
          type="text"
          className="glass-input"
          placeholder="Новый тег"
          value={newName}
          maxLength={MAX_TAG_LENGTH}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleCreate()
          }}
        />
        <button
          className="btn-sm-accent"
          disabled={createTag.isPending || newName.trim() === ''}
          onClick={handleCreate}
        >
          Добавить
        </button>
      </div>
    </>
  )
}
