"""Классы аутентификации проекта."""

from __future__ import annotations

from rest_framework.authentication import SessionAuthentication


class CsrfEnforcedSessionAuthentication(SessionAuthentication):
    """SessionAuthentication, проверяющая CSRF и у анонимных запросов.

    Штатный класс DRF вызывает enforce_csrf только после того, как убедился,
    что пользователь аутентифицирован. Для входа и регистрации это означает
    отсутствие проверки вовсе — и возможность login CSRF: жертву незаметно
    логинят в аккаунт атакующего.

    Декоратор csrf_protect эту дыру тоже закрывает, но отвечает HTML-страницей
    Django мимо обработчика ошибок DRF. Здесь же сбой поднимается как
    PermissionDenied и приходит клиенту в общем конверте с кодом csrf_failed.
    """

    def authenticate(self, request):
        self.enforce_csrf(request)
        return super().authenticate(request)
