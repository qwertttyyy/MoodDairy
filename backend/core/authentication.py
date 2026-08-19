"""Классы аутентификации API."""

from __future__ import annotations

from rest_framework.authentication import SessionAuthentication


class CsrfEnforcedSessionAuthentication(SessionAuthentication):
    """Проверяет CSRF для сессионных и анонимных запросов.

    Нужен для публичных эндпоинтов входа и регистрации.
    """

    def authenticate(self, request):
        """Проверяет CSRF перед стандартной сессионной аутентификацией."""
        self.enforce_csrf(request)
        return super().authenticate(request)
