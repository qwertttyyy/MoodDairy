"""Чтение переменных окружения с явной обязательностью и типами.

Переменная без значения по умолчанию считается обязательной: приложение падает
на старте, а не запускается молча с небезопасным значением.
"""

from __future__ import annotations

import os

from django.core.exceptions import ImproperlyConfigured


def env_str(name: str, default: str | None = None) -> str:
    """Строка. Если default не задан — переменная обязательна."""
    value = os.environ.get(name, default)
    if value is None or value == "":
        raise ImproperlyConfigured(
            f"Переменная окружения {name} обязательна и не может быть пустой"
        )
    return value


def env_bool(name: str, default: bool = False) -> bool:
    """Булево значение: 1/true/yes/on → True, остальное → False."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def env_int(name: str, default: int) -> int:
    """Целое число с проверкой формата."""
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
    """Список через запятую. Если default не задан — переменная обязательна."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        if default is None:
            raise ImproperlyConfigured(
                f"Переменная окружения {name} обязательна"
            )
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]
