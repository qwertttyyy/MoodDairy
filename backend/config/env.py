"""Читает и проверяет типизированные переменные окружения."""

from __future__ import annotations

import os

from django.core.exceptions import ImproperlyConfigured


def env_str(name: str, default: str | None = None) -> str:
    """Возвращает непустую строку или сообщает об обязательной переменной."""
    value = os.environ.get(name, default)
    if value is None or value == "":
        raise ImproperlyConfigured(
            f"Переменная окружения {name} обязательна и не может быть пустой"
        )
    return value


def env_bool(name: str, default: bool = False) -> bool:
    """Возвращает булево значение из распространённых строковых форм."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def env_int(name: str, default: int) -> int:
    """Возвращает целое значение переменной или значение по умолчанию."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ImproperlyConfigured(
            f"{name} должна быть числом, получено: {raw!r}"
        ) from exc


def env_list(name: str, default: list[str] | None = None) -> list[str]:
    """Возвращает непустые значения переменной, разделённые запятыми."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        if default is None:
            raise ImproperlyConfigured(
                f"Переменная окружения {name} обязательна"
            )
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]
