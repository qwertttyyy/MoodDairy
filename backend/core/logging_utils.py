from __future__ import annotations

import json
import logging
import threading
import traceback
from datetime import datetime, timezone

_local = threading.local()


def get_request_context() -> dict:
    """Возвращает контекст текущего запроса из thread-local."""
    return getattr(_local, "request_context", {})


def set_request_context(**kwargs) -> None:
    _local.request_context = kwargs


def clear_request_context() -> None:
    _local.request_context = {}


class RequestContextFilter(logging.Filter):
    """Добавляет request_id, user_id, ip в каждый LogRecord."""

    def filter(self, record: logging.LogRecord) -> bool:
        ctx = get_request_context()
        record.request_id = ctx.get("request_id", "-")
        record.user_id = ctx.get("user_id")
        record.ip = ctx.get("ip", "-")
        record.method = ctx.get("method", "")
        record.path = ctx.get("path", "")
        return True


class JSONFormatter(logging.Formatter):
    """Форматирует LogRecord в одну JSON-строку для stdout."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": datetime.fromtimestamp(
                record.created, tz=timezone.utc
            ).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
            "user_id": getattr(record, "user_id", None),
            "ip": getattr(record, "ip", "-"),
        }

        if method := getattr(record, "method", ""):
            log_entry["method"] = method

        if path := getattr(record, "path", ""):
            log_entry["path"] = path

        if hasattr(record, "status_code"):
            log_entry["status_code"] = record.status_code

        if hasattr(record, "duration_ms"):
            log_entry["duration_ms"] = record.duration_ms

        if record.exc_info and record.exc_info[1] is not None:
            log_entry["exception"] = traceback.format_exception(
                *record.exc_info
            )

        return json.dumps(log_entry, ensure_ascii=False, default=str)
