"""Общие настройки для всех сред.

Здесь не должно быть ни одного `if` по среде: различия живут в dev.py, prod.py
и test.py. Значения по умолчанию рассчитаны на удобство локальной разработки —
prod.py перечитывает всё критичное уже без умолчаний, чтобы боевой запуск падал
при незаданной переменной, а не работал с небезопасным значением.
"""

from pathlib import Path

from dotenv import load_dotenv

from config.env import env_bool, env_int, env_list, env_str

BASE_DIR = Path(__file__).resolve().parents[2]

load_dotenv()

SECRET_KEY = env_str("SECRET_KEY", "insecure-dev-key-change-me")
DEBUG = False
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", ["localhost", "127.0.0.1"])
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", ["http://localhost"])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "accounts",
    "entries",
    "sharing",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Статику админки и DRF отдаёт сам gunicorn: nginx проксирует
    # /static/ сюда, наружу из контейнера каталог не выставляется.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "core.middleware.RequestLoggingMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        # Своих шаблонов нет: HTML раздаёт фронтенд. Остаются шаблоны админки.
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env_str("DB_NAME", "moods"),
        "USER": env_str("DB_USER", "moods"),
        "PASSWORD": env_str("DB_PASSWORD", "moods"),
        "HOST": env_str("DB_HOST", "db"),
        "PORT": env_str("DB_PORT", "5432"),
    }
}

CACHE_TTL = env_int("CACHE_TTL", 60 * 60 * 24)

# Версия формата кэшируемых данных. Поднимать в том же коммите, где меняется
# состав полей в ответах: старые ключи мгновенно становятся недостижимыми,
# новые пишутся в своё пространство, мусор уходит по TTL. Без этого после
# деплоя пользователи получали бы из кэша ответы в старом формате.
CACHE_SCHEMA_VERSION = 2

REDIS_HOST = env_str("REDIS_HOST", "127.0.0.1")
REDIS_PORT = env_str("REDIS_PORT", "6379")
REDIS_PASSWORD = env_str("REDIS_PASSWORD", "dev-redis-password")
REDIS_DB = env_str("REDIS_DB", "0")

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": (
            f"redis://:{REDIS_PASSWORD}@{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}"
        ),
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
            "CONNECTION_POOL_KWARGS": {
                "max_connections": 40,
                "retry_on_timeout": True,
                "socket_keepalive": True,
            },
        },
        "KEY_PREFIX": f"moods:v{CACHE_SCHEMA_VERSION}",
        "TIMEOUT": CACHE_TTL,
    }
}

# Кэш — ускоритель, а не обязательная зависимость: при недоступном Redis
# запросы обслуживаются из БД, а ошибки уходят в лог, а не пользователю.
DJANGO_REDIS_IGNORE_EXCEPTIONS = True
DJANGO_REDIS_LOG_IGNORED_EXCEPTIONS = True

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_RENDERER_CLASSES": ("rest_framework.renderers.JSONRenderer",),
    # Общие лимиты частоты: без них любой авторизованный клиент может
    # нагружать API без ограничений.
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "60/minute",
        "user": "300/minute",
        # Вход и регистрация — защита от перебора паролей.
        "auth": "10/minute",
        # Публичная страница врача: токен не перебирается, но блоб крупный.
        "share": "30/minute",
        # Выгрузка всей истории при создании ссылки врачу — редко и дорого.
        "snapshot": "10/minute",
    },
    # Единый конверт ошибок для всего API, см. docs/api-errors.md.
    "EXCEPTION_HANDLER": "core.exception_handlers.api_exception_handler",
}

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": (
            "django.contrib.auth.password_validation"
            ".UserAttributeSimilarityValidator"
        )
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation.MinimumLengthValidator"
        )
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation.CommonPasswordValidator"
        )
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation.NumericPasswordValidator"
        )
    },
]

LOG_LEVEL = env_str("LOG_LEVEL", "INFO")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "request_context": {
            "()": "core.logging_utils.RequestContextFilter",
        },
    },
    "formatters": {
        "json": {
            "()": "core.logging_utils.JSONFormatter",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
            "filters": ["request_context"],
        },
    },
    "loggers": {
        "core.request": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
        "core.errors": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
        "accounts": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
        "entries": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
        "sharing": {
            "handlers": ["console"],
            "level": LOG_LEVEL,
            "propagate": False,
        },
        "django_redis.cache": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": False,
        },
        "django.request": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": False,
        },
        "django.server": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": False,
        },
        "django.db.backends": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": False,
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "WARNING",
    },
}

LANGUAGE_CODE = "ru"
TIME_ZONE = "Europe/Moscow"
USE_I18N = True
USE_TZ = True

# Статика только служебная (админка, DRF): collectstatic собирает её из
# приложений, раздаёт WhiteNoise. Ассеты приложения живут в сборке фронтенда.
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"

# Фронтенд читает CSRF-токен из cookie, поэтому HttpOnly здесь снят осознанно.
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Lax"

# HTTPS терминирует nginx и передаёт исходный протокол этим заголовком.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Редирект HTTP → HTTPS делает nginx перед Django: дублирование не нужно
# и рискует зациклиться при ошибке в настройке прокси.
SECURE_SSL_REDIRECT = False

# Запрет встраивания в iframe — защита от кликджекинга. В Django 6 это
# значение по умолчанию, прописано явно, чтобы не зависеть от версии.
X_FRAME_OPTIONS = "DENY"

ENCRYPTION_ENABLED = env_bool("ENCRYPTION_ENABLED", True)
