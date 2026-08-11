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
    """Кэш ответов DRF, изолированный по пользователю.

    Инвалидация версионная: инкремент версии меняет ключи пользователя разом,
    старые записи становятся недостижимыми и умирают по TTL. Это дешевле
    удаления по маске — то требует обхода всего пространства ключей Redis
    и не атомарно.

    У ключа версии TTL нет намеренно: истеки он раньше данных, счётчик
    сбросился бы в единицу и всплыли бы записи первого поколения.
    """

    def __init__(self, prefix: str, ttl: int | None = None) -> None:
        self.prefix = prefix
        self._ttl = ttl

    @property
    def ttl(self) -> int:
        """Настройка читается лениво: иначе override_settings не сработает."""
        return self._ttl if self._ttl is not None else settings.CACHE_TTL

    def _version_key(self, user_id: int) -> str:
        return f"{self.prefix}:ver:{user_id}"

    def _get_version(self, user_id: int) -> int:
        key = self._version_key(user_id)
        version = cache.get(key)
        if version is None:
            cache.add(key, 1, timeout=None)
            version = cache.get(key) or 1
        return version

    def _build_key(self, user_id: int, action: str, params: dict) -> str:
        params_hash = hashlib.md5(
            json.dumps(sorted(params.items())).encode(), usedforsecurity=False
        ).hexdigest()[:12]
        version = self._get_version(user_id)
        return f"{self.prefix}:u{user_id}:v{version}:{action}:{params_hash}"

    def invalidate(self, user_id: int) -> None:
        """Сбрасывает весь кэш пользователя инкрементом версии."""
        key = self._version_key(user_id)
        try:
            cache.incr(key)
        except ValueError:
            cache.set(key, 1, timeout=None)

    def invalidate_on_commit(self, user_id: int) -> None:
        """Сбрасывает кэш после успешного коммита текущей транзакции.

        Вне транзакции (обычный режим autocommit) выполняется сразу же.
        Нужно на случай включения ATOMIC_REQUESTS: иначе при откате в кэше
        останутся данные, которых в базе нет.
        """
        transaction.on_commit(lambda: self.invalidate(user_id))

    def cache_response(self, *, key_params: Iterable[str] = ()) -> Callable:
        """Кэширует успешный ответ метода DRF-вьюхи.

        В ключ попадают только перечисленные query-параметры. Белый список
        обязателен: если брать все, то запросы вида ?x=1, ?x=2, … создадут
        неограниченное число одинаковых по содержимому записей и вытеснят
        из Redis полезные данные.
        """
        allowed = tuple(key_params)

        def decorator(func: Callable) -> Callable:
            @wraps(func)
            def wrapper(
                view: Any, request: Request, *args: Any, **kwargs: Any
            ) -> Response:
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
