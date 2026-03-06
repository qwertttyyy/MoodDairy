from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone


class Tag(models.Model):
    """Тег настроения. Создаётся в админке, общий для всех."""

    name = models.CharField(
        max_length=50, unique=True, verbose_name="Название"
    )

    class Meta:
        verbose_name = "Тег"
        verbose_name_plural = "Теги"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class MoodEntry(models.Model):
    """Запись настроения. mood и note зашифрованы на клиенте (iv:ciphertext)."""

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
        ]

    def __str__(self) -> str:
        return (
            f"Entry #{self.pk} — {self.user} — {self.timestamp:%d.%m.%Y %H:%M}"
        )
