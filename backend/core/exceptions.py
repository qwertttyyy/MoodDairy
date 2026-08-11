"""Прикладные исключения API.

Каждое несёт свой машиночитаемый код из контракта (docs/api-errors.md).
Поднимать исключение предпочтительнее, чем собирать Response вручную:
формат ответа тогда задаётся одним обработчиком, а не копируется по вьюхам.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.exceptions import APIException


class InvalidCredentials(APIException):
    """Неверная пара логин/пароль или деактивированный аккаунт."""

    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "Неверный логин или пароль."
    default_code = "invalid_credentials"


class WrappingKeyMissing(APIException):
    """Ключ пропал из сессии: расшифровать данные на клиенте нечем."""

    status_code = status.HTTP_401_UNAUTHORIZED
    default_detail = "Ключ шифрования недоступен. Требуется повторный вход."
    default_code = "wrapping_key_missing"


class Gone(APIException):
    """Ресурс существовал, но больше недоступен: истёк или отозван."""

    status_code = status.HTTP_410_GONE
    default_detail = "Ссылка недействительна."
    default_code = "gone"
