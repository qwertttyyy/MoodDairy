from __future__ import annotations

import secrets

from django.conf import settings
from django.db import models
from django.utils import timezone


def generate_token() -> str:
    return secrets.token_urlsafe(24)


class SharedAccess(models.Model):
    """Снапшот записей, зашифрованный одноразовым ключом."""

    token = models.CharField(
        max_length=64,
        unique=True,
        default=generate_token,
        db_index=True,
    )
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="shared_access",
    )
    data_blob = models.TextField(verbose_name="Данные (шифротекст или JSON)")
    is_encrypted = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Общий доступ"
        verbose_name_plural = "Общие доступы"
        ordering = ["-created_at"]

    @property
    def is_expired(self) -> bool:
        return self.expires_at is not None and timezone.now() > self.expires_at

    @property
    def is_valid(self) -> bool:
        return self.is_active and not self.is_expired

    def __str__(self) -> str:
        return f"Share {self.token[:8]}… — {self.user}"
