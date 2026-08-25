/** Управление пользовательскими тегами внутри настроек. */

import { useState } from 'react'

import { isApiError } from '../../shared/api/client'
import type { Tag } from '../../shared/api/types'
import { useConfirm } from '../../shared/ui/confirm'
import { ErrorState } from '../../shared/ui/QueryState'
import { useToast } from '../../shared/ui/toast'
import { useCreateTag, useDeleteTag, useRenameTag, useTags } from './api'

const MAX_TAG_LENGTH = 50

/** Текст ошибки от сервера: у валидации он лежит в поле, иначе — общий. */
function errorText(error: unknown, fallback: string): string {
  if (!isApiError(error)) return fallback
  return error.fields.name?.[0] ?? error.message ?? fallback
}

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M14.5 6.5 17.5 9.5" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 7h15M9 3.8h6M7 7l.8 13.2h8.4L17 7M10 10.5v6M14 10.5v6" />
    </svg>
  )
}

/** Строка тега с явными действиями переименования и удаления. */
function TagRow({ tag, onEdit, onDelete }: { tag: Tag; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="set-row">
      <span className="set-label">{tag.name}</span>
      <div className="tag-actions">
        <button
          type="button"
          className="tag-action tag-edit"
          aria-label={`Переименовать тег «${tag.name}»`}
          onClick={onEdit}
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          className="tag-action tag-remove"
          aria-label={`Удалить тег «${tag.name}»`}
          onClick={onDelete}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  )
}

export function TagsSection({ active = true }: { active?: boolean }) {
  const toast = useToast()
  const confirm = useConfirm()
  const { data: tags = [], error, isPending, refetch } = useTags(active)
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
      onConfirm: async () => {
        await deleteTag.mutateAsync(tag.id)
        toast('Тег удалён')
      },
    })
  }

  if (error) {
    return (
      <div className="settings-group">
        <ErrorState message="Не удалось загрузить теги" onRetry={() => void refetch()} />
      </div>
    )
  }

  return (
    <div
      className="settings-group"
      aria-busy={isPending || createTag.isPending || renameTag.isPending || deleteTag.isPending}
    >
      {isPending && (
        <div className="set-row">
          <span className="set-hint">Загрузка…</span>
        </div>
      )}

      {!isPending && tags.length === 0 && (
        <div className="set-row">
          <span className="set-hint">Пока нет ни одного тега</span>
        </div>
      )}

      {tags.map((tag) => (
        <div key={tag.id}>
          {editingId === tag.id ? (
            <div className="set-row">
              <input
                type="text"
                className="tag-input"
                aria-label={`Новое название тега «${tag.name}»`}
                value={editingName}
                maxLength={MAX_TAG_LENGTH}
                autoFocus
                onChange={(event) => setEditingName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleRename(tag)
                  if (event.key === 'Escape') cancelEditing()
                }}
              />
              <button type="button" className="btn-plain" onClick={cancelEditing}>
                Отмена
              </button>
              <button
                type="button"
                className="btn-plain"
                disabled={renameTag.isPending}
                aria-busy={renameTag.isPending}
                onClick={() => handleRename(tag)}
              >
                Готово
              </button>
            </div>
          ) : (
            <TagRow tag={tag} onEdit={() => startEditing(tag)} onDelete={() => handleDelete(tag)} />
          )}
          <div className="set-sep" />
        </div>
      ))}

      <div className="set-row">
        <input
          type="text"
          className="tag-input"
          aria-label="Название нового тега"
          placeholder="Новый тег"
          value={newName}
          maxLength={MAX_TAG_LENGTH}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleCreate()
          }}
        />
        <button
          type="button"
          className="btn-plain"
          disabled={createTag.isPending || newName.trim() === ''}
          aria-busy={createTag.isPending}
          onClick={handleCreate}
        >
          Добавить
        </button>
      </div>
    </div>
  )
}
