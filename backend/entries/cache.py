from __future__ import annotations

from functools import wraps
from typing import Any, Callable

from django.core.cache import cache
from rest_framework.request import Request
from rest_framework.response import Response

from entries.constants import CACHE_PREFIX, CACHE_TTL, VERSION_TTL


def _version_key(user_id: int) -> str:
    return f"{CACHE_PREFIX}:ver:{user_id}"


def _get_version(user_id: int) -> int:
    ver = cache.get(_version_key(user_id))
    if ver is None:
        cache.set(_version_key(user_id), 1, VERSION_TTL)
        return 1
    return ver


def _make_key(user_id: int, action_name: str, params: dict) -> str:
    ver = _get_version(user_id)
    sorted_params = sorted(params.items())
    return f"{CACHE_PREFIX}:u{user_id}:v{ver}:{action_name}:{sorted_params}"


def invalidate_user_cache(user_id: int) -> None:
    """Инкремент версии. Старые ключи истекут по TTL."""
    key = _version_key(user_id)
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, VERSION_TTL)


def cached_action(func: Callable) -> Callable:
    """Декоратор: кэширует response.data по user + version + action + query params."""

    @wraps(func)
    def wrapper(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        key = _make_key(request.user.id, func.__name__, request.query_params)
        cached_data = cache.get(key)
        if cached_data is not None:
            return Response(cached_data)

        response = func(self, request, *args, **kwargs)

        if response.status_code == 200:
            cache.set(key, response.data, CACHE_TTL)

        return response

    return wrapper
