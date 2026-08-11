"""Единый формат ошибок API.

Любая ошибка приходит клиенту в одном конверте:

    {"error": {"code", "message", "fields" (опц.), "request_id"}}

Роли полей разные и путать их нельзя:
  * HTTP-статус  — для инфраструктуры (прокси, мониторинг, ретраи);
  * ``code``     — для кода фронтенда, стабильный и машиночитаемый;
  * ``message``  — для человека на экране, может меняться и переводиться;
  * ``fields``   — подсветка полей формы, только для ошибок валидации;
  * ``request_id`` — связь жалобы пользователя со строкой лога.

Полный список кодов — в docs/api-errors.md.
"""

from __future__ import annotations

import logging
from typing import Any

from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.db import IntegrityError
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from .logging_utils import get_request_context

logger = logging.getLogger("core.errors")

# Соответствие классов исключений DRF кодам контракта. Свой словарь
# вместо exc.get_codes(): коды DRF меняются между версиями библиотеки,
# а контракт с фронтендом меняться не должен.
EXCEPTION_CODES: dict[type[Exception], str] = {
    exceptions.ValidationError: "validation_error",
    exceptions.NotAuthenticated: "not_authenticated",
    exceptions.AuthenticationFailed: "not_authenticated",
    exceptions.PermissionDenied: "permission_denied",
    exceptions.NotFound: "not_found",
    exceptions.MethodNotAllowed: "method_not_allowed",
    exceptions.UnsupportedMediaType: "unsupported_media_type",
    exceptions.Throttled: "rate_limited",
}

VALIDATION_MESSAGE = "Проверьте правильность заполнения полей"
INTERNAL_MESSAGE = "Внутренняя ошибка сервера. Попробуйте позже."
FALLBACK_MESSAGE = "Не удалось выполнить запрос"

# Ключ, под который DRF складывает ошибки уровня объекта.
NON_FIELD_KEY = "non_field_errors"


def api_exception_handler(exc: Exception, context: dict) -> Response | None:
    """Обработчик для REST_FRAMEWORK["EXCEPTION_HANDLER"]."""
    exc = _normalize_exception(exc)
    response = drf_exception_handler(exc, context)
    request_id = get_request_context().get("request_id", "-")

    if response is None:
        return _handle_unexpected(exc, request_id)

    error: dict[str, Any] = {
        "code": _resolve_code(exc),
        "message": "",
        "request_id": request_id,
    }

    if isinstance(exc, exceptions.ValidationError):
        fields = _normalize_fields(response.data)
        error["message"] = _validation_message(fields)
        error["fields"] = fields
    else:
        error["message"] = _detail_message(response.data)

    response.data = {"error": error}
    return response


def _normalize_exception(exc: Exception) -> Exception:
    """Переводит исключения Django в аналоги DRF.

    DRF делает часть этой работы внутри себя, но не отдаёт нам изменённый
    объект — а код ошибки мы определяем именно по типу исключения. Без
    нормализации Http404 из get_object_or_404 получил бы код "error" вместо
    "not_found", а голый ObjectDoesNotExist из `obj.related` — вовсе 500.
    """
    if isinstance(exc, (Http404, ObjectDoesNotExist)):
        return exceptions.NotFound()
    if isinstance(exc, DjangoPermissionDenied):
        return exceptions.PermissionDenied()
    if isinstance(exc, IntegrityError):
        return exceptions.ValidationError("Конфликт данных, повторите запрос.")
    return exc


def _resolve_code(exc: Exception) -> str:
    """Машиночитаемый код ошибки."""
    # CSRF-сбой DRF отдаёт как PermissionDenied — отличаем по тексту, иначе
    # фронт не сможет отреагировать обновлением токена.
    if isinstance(exc, exceptions.PermissionDenied):
        if str(getattr(exc, "detail", "")).startswith("CSRF Failed"):
            return "csrf_failed"

    mapped = EXCEPTION_CODES.get(type(exc))
    if mapped is not None:
        return mapped

    # Прикладные исключения из core.exceptions несут код в default_code.
    code = getattr(exc, "default_code", None)
    return str(code) if code else "error"


def _normalize_fields(data: Any) -> dict[str, list[str]]:
    """Приводит detail ValidationError к виду {"поле": ["сообщение", ...]}.

    DRF отдаёт его в трёх формах: словарь по полям, плоский список сообщений
    и вложенные структуры для сериализаторов внутри сериализаторов.
    """
    if isinstance(data, dict):
        return {key: _flatten(value) for key, value in data.items()}
    if isinstance(data, list):
        return {NON_FIELD_KEY: _flatten(data)}
    return {NON_FIELD_KEY: [str(data)]}


def _flatten(value: Any) -> list[str]:
    """Разворачивает вложенные списки и словари в плоский список строк."""
    if isinstance(value, list):
        result: list[str] = []
        for item in value:
            result.extend(_flatten(item))
        return result
    if isinstance(value, dict):
        result = []
        for key, nested in value.items():
            result.extend(f"{key}: {msg}" for msg in _flatten(nested))
        return result
    return [str(value)]


def _validation_message(fields: dict[str, list[str]]) -> str:
    """Ошибку уровня объекта показываем пользователю как есть."""
    non_field = fields.get(NON_FIELD_KEY)
    if non_field:
        return non_field[0]
    return VALIDATION_MESSAGE


def _detail_message(data: Any) -> str:
    """Достаёт человекочитаемый текст из ответа DRF."""
    if isinstance(data, dict):
        detail = data.get("detail")
        if detail:
            return str(detail)
    if isinstance(data, list) and data:
        return str(data[0])
    return FALLBACK_MESSAGE


def _handle_unexpected(exc: Exception, request_id: str) -> Response | None:
    """Необработанное исключение: клиенту общий текст, детали — в лог.

    При DEBUG возвращаем None, чтобы Django показал свою страницу
    с трассировкой.
    """
    if settings.DEBUG:
        return None

    logger.exception("Unhandled exception: %s", type(exc).__name__)
    return Response(
        {
            "error": {
                "code": "internal_error",
                "message": INTERNAL_MESSAGE,
                "request_id": request_id,
            }
        },
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
