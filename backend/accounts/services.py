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
    """Создаёт User, UserProfile и стартовые теги одной транзакцией.

    IntegrityError перехватывается из-за гонки: между проверкой занятости
    имени в сериализаторе и вставкой параллельный запрос может занять то же
    имя, и пользователь получил бы 500 вместо понятной ошибки.
    """
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
    """Проверяет учётные данные.

    Ответ одинаков для неверного пароля, несуществующего пользователя и
    отключённого аккаунта: иначе по коду ошибки можно перебирать логины.
    """
    user = authenticate(username=username, password=password)
    if user is None or not user.is_active:
        logger.warning("Login failed for username=%s", username)
        raise InvalidCredentials()
    return user
