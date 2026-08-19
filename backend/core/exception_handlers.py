"""Приводит исключения API к единому формату ответа.

Добавляет стабильный код ошибки и идентификатор запроса.
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

# Коды контракта не зависят от внутренних кодов конкретной версии DRF.
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

NON_FIELD_KEY = "non_field_errors"


def api_exception_handler(exc: Exception, context: dict) -> Response | None:
    """Возвращает ошибку DRF в публичном формате API."""
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
    """Заменяет исключения Django эквивалентными исключениями DRF."""
    if isinstance(exc, (Http404, ObjectDoesNotExist)):
        return exceptions.NotFound()
    if isinstance(exc, DjangoPermissionDenied):
        return exceptions.PermissionDenied()
    if isinstance(exc, IntegrityError):
        return exceptions.ValidationError("Конфликт данных, повторите запрос.")
    return exc


def _resolve_code(exc: Exception) -> str:
    """Определяет стабильный машиночитаемый код исключения."""
    # DRF представляет CSRF-сбой как PermissionDenied.
    if isinstance(exc, exceptions.PermissionDenied):
        if str(getattr(exc, "detail", "")).startswith("CSRF Failed"):
            return "csrf_failed"

    mapped = EXCEPTION_CODES.get(type(exc))
    if mapped is not None:
        return mapped

    code = getattr(exc, "default_code", None)
    return str(code) if code else "error"


def _normalize_fields(data: Any) -> dict[str, list[str]]:
    """Преобразует детали валидации в словарь сообщений по полям."""
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
    """Выбирает сообщение общей ошибки или текст по умолчанию."""
    non_field = fields.get(NON_FIELD_KEY)
    if non_field:
        return non_field[0]
    return VALIDATION_MESSAGE


def _detail_message(data: Any) -> str:
    """Извлекает отображаемое пользователю сообщение из ответа DRF."""
    if isinstance(data, dict):
        detail = data.get("detail")
        if detail:
            return str(detail)
    if isinstance(data, list) and data:
        return str(data[0])
    return FALLBACK_MESSAGE


def _handle_unexpected(exc: Exception, request_id: str) -> Response | None:
    """Логирует непредвиденную ошибку и скрывает её детали от клиента."""
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
