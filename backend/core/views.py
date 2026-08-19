from __future__ import annotations

import logging

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger("core.request")

HEALTH_CACHE_KEY = "health:probe"


@method_decorator(ensure_csrf_cookie, name="dispatch")
class ConfigView(APIView):
    """Возвращает публичную конфигурацию и устанавливает CSRF-cookie."""

    permission_classes = (AllowAny,)
    authentication_classes = []

    def get(self, request: Request) -> Response:
        """Возвращает состояние клиентского шифрования."""
        return Response({"encryption_enabled": settings.ENCRYPTION_ENABLED})


class HealthView(APIView):
    """Проверяет доступность базы данных и кэша.

    Отказ кэша отражается в ответе, но не делает сервис недоступным.
    """

    permission_classes = (AllowAny,)
    authentication_classes = []
    throttle_classes = ()

    def get(self, request: Request) -> Response:
        """Возвращает состояние доступных зависимостей приложения."""
        database_ok = self._check_database()
        cache_ok = self._check_cache()

        body = {
            "status": "ok" if database_ok else "unavailable",
            "database": "ok" if database_ok else "error",
            "cache": "ok" if cache_ok else "error",
        }
        code = (
            status.HTTP_200_OK
            if database_ok
            else status.HTTP_503_SERVICE_UNAVAILABLE
        )
        return Response(body, status=code)

    @staticmethod
    def _check_database() -> bool:
        """Проверяет выполнение простого запроса к базе данных."""
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        except Exception:
            logger.exception("Health check: database unavailable")
            return False
        return True

    @staticmethod
    def _check_cache() -> bool:
        """Проверяет запись и чтение значения из кэша."""
        try:
            cache.set(HEALTH_CACHE_KEY, "1", 10)
            return cache.get(HEALTH_CACHE_KEY) == "1"
        except Exception:
            logger.exception("Health check: cache unavailable")
            return False
