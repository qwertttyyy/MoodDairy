from __future__ import annotations

import logging
import time
import uuid

from django.http import HttpRequest, HttpResponse

from .logging_utils import clear_request_context, set_request_context

logger = logging.getLogger("core.request")

SKIP_PATHS = ("/static/", "/favicon.ico")


class RequestLoggingMiddleware:
    """Генерирует request_id, логирует каждый запрос одной строкой."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        if any(request.path.startswith(p) for p in SKIP_PATHS):
            return self.get_response(request)

        request_id = uuid.uuid4().hex[:8]
        request.request_id = request_id

        user_id = (
            request.user.id
            if hasattr(request, "user") and request.user.is_authenticated
            else None
        )
        ip = self._get_client_ip(request)

        set_request_context(
            request_id=request_id,
            user_id=user_id,
            ip=ip,
            method=request.method,
            path=request.path,
        )

        start = time.monotonic()
        response = self.get_response(request)
        duration_ms = round((time.monotonic() - start) * 1000, 1)

        user_id = (
            request.user.id
            if hasattr(request, "user") and request.user.is_authenticated
            else user_id
        )

        level = (
            logging.WARNING if response.status_code >= 400 else logging.INFO
        )

        logger.log(
            level,
            "%s %s %s %.1fms",
            request.method,
            request.path,
            response.status_code,
            duration_ms,
            extra={
                "status_code": response.status_code,
                "duration_ms": duration_ms,
                "user_id": user_id,
            },
        )

        response["X-Request-ID"] = request_id
        clear_request_context()
        return response

    @staticmethod
    def _get_client_ip(request: HttpRequest) -> str:
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "unknown")
