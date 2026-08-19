from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from .constants import SHARED_ACCESS_EXPIRE_HOURS
from .models import SharedAccess, generate_token

User = get_user_model()


@transaction.atomic
def create_or_update_share(user: User, data_blob: str) -> SharedAccess:
    """Создаёт или заменяет ссылку пользователя новым токеном."""
    expires_at = timezone.now() + timedelta(hours=SHARED_ACCESS_EXPIRE_HOURS)
    shared, _ = SharedAccess.objects.update_or_create(
        user=user,
        defaults={
            "data_blob": data_blob,
            "is_encrypted": settings.ENCRYPTION_ENABLED,
            "expires_at": expires_at,
            "is_active": True,
            "token": generate_token(),
        },
    )
    return shared


def revoke_share(user: User) -> bool:
    """Деактивирует ссылку. Возвращает True, если ссылка существовала."""
    try:
        shared = user.shared_access
    except SharedAccess.DoesNotExist:
        return False
    shared.is_active = False
    shared.save(update_fields=["is_active"])
    return True


def get_active_share(user: User) -> SharedAccess | None:
    """Возвращает активную непросроченную ссылку или None."""
    try:
        shared = user.shared_access
    except SharedAccess.DoesNotExist:
        return None
    if not shared.is_valid:
        return None
    return shared
