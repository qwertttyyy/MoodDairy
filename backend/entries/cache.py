from __future__ import annotations

import hashlib
from functools import wraps
from typing import Any, Callable

from django.core.cache import cache
from rest_framework.request import Request
from rest_framework.response import Response

from entries.constants import CACHE_PREFIX, CACHE_TTL


def _make_key(user_id: int, action_name: str, params: dict) -> str:
    sorted_params = sorted(params.items())
    raw = f"{user_id}:{action_name}:{sorted_params}"
    digest = hashlib.md5(raw.encode(), usedforsecurity=False).hexdigest()[:12]
    return f"{CACHE_PREFIX}:{user_id}:{digest}"


def _track_key(user_id: int, key: str) -> None:
    registry = f"{CACHE_PREFIX}:keys:{user_id}"
    keys: set[str] = cache.get(registry) or set()
    keys.add(key)
    cache.set(registry, keys, CACHE_TTL * 2)


def invalidate_user_cache(user_id: int) -> None:
    registry = f"{CACHE_PREFIX}:keys:{user_id}"
    keys: set[str] = cache.get(registry) or set()
    for k in keys:
        cache.delete(k)
    cache.delete(registry)


def cached_action(func: Callable) -> Callable:
    """Декоратор: кэширует response.data по user + action + query params."""

    @wraps(func)
    def wrapper(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        key = _make_key(request.user.id, func.__name__, request.query_params)
        cached = cache.get(key)
        if cached is not None:
            return Response(cached)

        response = func(self, request, *args, **kwargs)

        if response.status_code == 200:
            cache.set(key, response.data, CACHE_TTL)
            _track_key(request.user.id, key)

        return response

    return wrapper
