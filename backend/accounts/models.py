from __future__ import annotations

from django.conf import settings
from django.db import models


class UserProfile(models.Model):
    """Хранит соль, используемую клиентом для шифрования данных."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
    )
    encryption_salt = models.CharField(
        max_length=64,
        blank=True,
        verbose_name="Salt (base64)",
    )

    class Meta:
        """Настройки отображения профиля в Django."""

        verbose_name = "Профиль"
        verbose_name_plural = "Профили"

    def __str__(self) -> str:
        """Возвращает профиль в виде для административного интерфейса."""
        return f"Profile: {self.user.username}"
