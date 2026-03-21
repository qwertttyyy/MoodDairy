from __future__ import annotations

import base64
import os

from django.contrib.auth.models import User
from django.db import transaction
from rest_framework.request import Request

from .constants import WRAPPING_KEY_BYTES, WRAPPING_KEY_SESSION_KEY
from .models import UserProfile


def generate_wrapping_key() -> str:
    """32 случайных байта → base64."""
    return base64.b64encode(os.urandom(WRAPPING_KEY_BYTES)).decode("ascii")


def store_wrapping_key(request: Request) -> str:
    """Генерирует wrapping_key, сохраняет в сессию, возвращает base64."""
    key = generate_wrapping_key()
    request.session[WRAPPING_KEY_SESSION_KEY] = key
    request.session.save()
    return key


def get_wrapping_key(request: Request) -> str | None:
    """Извлекает wrapping_key из сессии."""
    return request.session.get(WRAPPING_KEY_SESSION_KEY)


def clear_wrapping_key(request: Request) -> None:
    """Удаляет wrapping_key из сессии."""
    request.session.pop(WRAPPING_KEY_SESSION_KEY, None)


@transaction.atomic
def register_user(username: str, password: str, encryption_salt: str) -> User:
    """Создаёт User + UserProfile атомарно."""
    user = User.objects.create_user(username=username, password=password)
    UserProfile.objects.create(user=user, encryption_salt=encryption_salt)
    return user
