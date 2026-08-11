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
    """Публичная конфигурация фронтенда: флаг шифрования + CSRF-cookie.

    SPA не рендерится Django-шаблоном, поэтому cookie `csrftoken` ставит
    этот эндпоинт — фронтенд вызывает его при старте, до любых мутаций.
    """

    permission_classes = (AllowAny,)
    # Пустой список отключает SessionAuthentication из DEFAULT-настроек:
    # эндпоинт публичный и не должен зависеть от сессии.
    authentication_classes = []

    def get(self, request: Request) -> Response:
        return Response({"encryption_enabled": settings.ENCRYPTION_ENABLED})


class HealthView(APIView):
    """Проверка живости для Docker и внешнего мониторинга.

    Отвечает 200 только если доступны обе зависимости. Без проверок «жив»
    означало бы всего лишь «процесс отвечает», хотя приложение уже не может
    обслуживать запросы.

    Redis не критичен: кэш — ускоритель, а не источник данных, поэтому его
    отказ отражается в теле ответа, но статус остаётся успешным.
    """

    permission_classes = (AllowAny,)
    authentication_classes = []
    throttle_classes = ()

    def get(self, request: Request) -> Response:
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
        try:
            cache.set(HEALTH_CACHE_KEY, "1", 10)
            return cache.get(HEALTH_CACHE_KEY) == "1"
        except Exception:
            logger.exception("Health check: cache unavailable")
            return False
