from __future__ import annotations

from django.conf import settings
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView


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
