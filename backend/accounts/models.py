from __future__ import annotations

from django.conf import settings
from django.db import models


class UserProfile(models.Model):
    """Хранит encryption_salt для client-side шифрования."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
    )
    encryption_salt = models.CharField(
        max_length=64,
        verbose_name="Salt (base64)",
    )

    class Meta:
        verbose_name = "Профиль"
        verbose_name_plural = "Профили"

    def __str__(self) -> str:
        return f"Profile: {self.user.username}"
