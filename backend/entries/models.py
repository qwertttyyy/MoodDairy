from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models.functions import TruncDate
from django.utils import timezone


class Tag(models.Model):
    """Тег настроения. У каждого пользователя свой набор.

    При удалении тега записи сохраняются: каскад убирает только строки
    промежуточной таблицы, и тег просто исчезает из списка тегов записи.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="tags",
        verbose_name="Пользователь",
    )
    name = models.CharField(max_length=50, verbose_name="Название")

    class Meta:
        verbose_name = "Тег"
        verbose_name_plural = "Теги"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "name"], name="uniq_tag_name_per_user"
            )
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.user})"


class MoodEntry(models.Model):
    """Запись настроения.

    Поля mood, note и anxiety шифруются на клиенте и хранятся в формате
    iv:ciphertext — сервер их содержимое не читает.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="mood_entries",
        verbose_name="Пользователь",
    )
    mood = models.TextField(verbose_name="Настроение (зашифровано)")
    note = models.TextField(
        blank=True, default="", verbose_name="Заметка (зашифровано)"
    )
    anxiety = models.TextField(
        blank=True, default="", verbose_name="Тревога (зашифровано)"
    )
    tags = models.ManyToManyField(
        Tag,
        blank=True,
        related_name="entries",
        verbose_name="Теги",
    )
    timestamp = models.DateTimeField(
        default=timezone.now, verbose_name="Дата и время"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Запись"
        verbose_name_plural = "Записи"
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["user", "-timestamp"]),
            # Лента группирует записи по календарным дням через TruncDate.
            # Обычный индекс по timestamp для DISTINCT по выражению не
            # применим, поэтому нужен функциональный.
            models.Index(
                TruncDate("timestamp"),
                "user",
                name="entry_user_day_idx",
            ),
        ]

    def __str__(self) -> str:
        return (
            f"Entry #{self.pk} — {self.user} — {self.timestamp:%d.%m.%Y %H:%M}"
        )
