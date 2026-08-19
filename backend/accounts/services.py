from __future__ import annotations

import base64
import logging
import os

from django.contrib.auth import authenticate, get_user_model
from django.db import IntegrityError, transaction
from rest_framework import serializers
from rest_framework.request import Request

from core.exceptions import InvalidCredentials
from entries.services import create_default_tags

from .constants import WRAPPING_KEY_BYTES, WRAPPING_KEY_SESSION_KEY
from .models import UserProfile

logger = logging.getLogger("accounts")

User = get_user_model()


def generate_wrapping_key() -> str:
    """Генерирует случайный wrapping key в кодировке base64."""
    return base64.b64encode(os.urandom(WRAPPING_KEY_BYTES)).decode("ascii")


def store_wrapping_key(request: Request) -> str:
    """Генерирует ключ, сохраняет его в сессии и возвращает клиенту."""
    key = generate_wrapping_key()
    request.session[WRAPPING_KEY_SESSION_KEY] = key
    request.session.save()
    return key


def get_wrapping_key(request: Request) -> str | None:
    """Возвращает wrapping key из сессии запроса."""
    return request.session.get(WRAPPING_KEY_SESSION_KEY)


def clear_wrapping_key(request: Request) -> None:
    """Удаляет wrapping key из сессии запроса."""
    request.session.pop(WRAPPING_KEY_SESSION_KEY, None)


@transaction.atomic
def register_user(username: str, password: str, encryption_salt: str) -> User:
    """Создаёт пользователя, профиль и начальные теги одной транзакцией."""
    try:
        user = User.objects.create_user(username=username, password=password)
    except IntegrityError as exc:
        raise serializers.ValidationError(
            {"username": "Имя пользователя занято."}
        ) from exc

    UserProfile.objects.create(user=user, encryption_salt=encryption_salt)
    create_default_tags(user)
    return user


def authenticate_user(username: str, password: str) -> User:
    """Аутентифицирует активного пользователя по имени и паролю.

    Неверные данные и неактивный аккаунт дают одинаковую ошибку.
    """
    user = authenticate(username=username, password=password)
    if user is None or not user.is_active:
        logger.warning("Login failed for username=%s", username)
        raise InvalidCredentials()
    return user
