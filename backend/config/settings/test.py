"""Настройки тестов.

Запуск: python manage.py test --settings=config.settings.test
"""

from .base import *  # noqa: F403

# Тесты идут в том же режиме, что и прод: DEBUG=True маскирует ошибки
# конфигурации и меняет поведение обработчиков исключений.
DEBUG = False

ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]

# Кэш — настоящий Redis: версионная инвалидация опирается на то, что INCRBY
# не сбрасывает TTL, а LocMemCache этого поведения не воспроизводит.
# Отдельный префикс изолирует тестовые ключи от ключей рабочей базы.
CACHES = {
    **CACHES,  # noqa: F405
    "default": {
        **CACHES["default"],  # noqa: F405
        "KEY_PREFIX": "test",
    },
}

# Тесты не должны зависеть от локального .env: базовый режим — шифрование
# включено, выключенный режим проверяется точечно через @override_settings.
ENCRYPTION_ENABLED = True

# Лимиты частоты подняты, чтобы не мешать прогону. Сами лимиты проверяют
# отдельные тесты — они возвращают боевые значения через override_settings.
REST_FRAMEWORK = {
    **REST_FRAMEWORK,  # noqa: F405
    "DEFAULT_THROTTLE_RATES": {
        "anon": "1000/minute",
        "user": "1000/minute",
        "auth": "1000/minute",
        "share": "1000/minute",
        "snapshot": "1000/minute",
    },
}

SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

LOGGING = {
    "version": 1,
    "disable_existing_loggers": True,
    "handlers": {
        "null": {
            "class": "logging.NullHandler",
        },
    },
    "root": {
        "handlers": ["null"],
        "level": "CRITICAL",
    },
}

# Хеширование пароля — самая долгая операция в тестах с пользователями.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.MD5PasswordHasher",
]

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
