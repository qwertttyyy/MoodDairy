from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterable
from functools import wraps
from typing import Any

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response


class UserScopedCache:
    """Кэширует ответы отдельно для каждого пользователя.

    Инвалидация меняет версию ключей, не удаляя записи по маске.
    """

    def __init__(self, prefix: str, ttl: int | None = None) -> None:
        """Сохраняет префикс и необязательное время жизни ответов."""
        self.prefix = prefix
        self._ttl = ttl

    @property
    def ttl(self) -> int:
        """Возвращает явный TTL или текущее значение настройки."""
        return self._ttl if self._ttl is not None else settings.CACHE_TTL

    def _version_key(self, user_id: int) -> str:
        """Строит ключ версии кэша пользователя."""
        return f"{self.prefix}:ver:{user_id}"

    def _get_version(self, user_id: int) -> int:
        """Получает версию кэша, создавая начальную при отсутствии."""
        key = self._version_key(user_id)
        version = cache.get(key)
        if version is None:
            cache.add(key, 1, timeout=None)
            version = cache.get(key) or 1
        return version

    def _build_key(self, user_id: int, action: str, params: dict) -> str:
        """Строит ключ ответа из пользователя, действия и параметров."""
        params_hash = hashlib.md5(
            json.dumps(sorted(params.items())).encode(), usedforsecurity=False
        ).hexdigest()[:12]
        version = self._get_version(user_id)
        return f"{self.prefix}:u{user_id}:v{version}:{action}:{params_hash}"

    def invalidate(self, user_id: int) -> None:
        """Делает текущие записи пользователя недостижимыми новой версией."""
        key = self._version_key(user_id)
        try:
            cache.incr(key)
        except ValueError:
            cache.set(key, 1, timeout=None)

    def invalidate_on_commit(self, user_id: int) -> None:
        """Откладывает инвалидацию до успешного коммита транзакции."""
        transaction.on_commit(lambda: self.invalidate(user_id))

    def cache_response(self, *, key_params: Iterable[str] = ()) -> Callable:
        """Создаёт декоратор для кэширования успешных ответов DRF-вьюхи.

        В ключ включаются только явно перечисленные параметры запроса.
        """
        allowed = tuple(key_params)

        def decorator(func: Callable) -> Callable:
            """Оборачивает метод представления кэшированием ответа."""

            @wraps(func)
            def wrapper(
                view: Any, request: Request, *args: Any, **kwargs: Any
            ) -> Response:
                """Возвращает кэшированный либо созданный ответ."""
                user = getattr(request, "user", None)
                if user is None or not user.is_authenticated:
                    return func(view, request, *args, **kwargs)

                params = {
                    name: request.query_params[name]
                    for name in allowed
                    if name in request.query_params
                }
                key = self._build_key(user.id, func.__name__, params)

                cached_data = cache.get(key)
                if cached_data is not None:
                    return Response(cached_data)

                response = func(view, request, *args, **kwargs)
                if response.status_code == status.HTTP_200_OK:
                    cache.set(key, response.data, self.ttl)
                return response

            return wrapper

        return decorator
