"""Настройки локальной разработки Django."""

from django.core.exceptions import ImproperlyConfigured

from config.env import env_bool

from .base import *  # noqa: F403

DEBUG = True

SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

LOG_ONLY_SQL_QUERIES = False

if LOG_ONLY_SQL_QUERIES:
    LOGGING = {
        "version": 1,
        "disable_existing_loggers": False,
        "handlers": {
            "console": {
                "level": "DEBUG",
                "class": "logging.StreamHandler",
            },
        },
        "loggers": {
            "django.db.backends": {
                "handlers": ["console"],
                "level": "DEBUG",
                "propagate": False,
            },
        },
    }

DISABLED_CACHE_BACKEND = False

if DISABLED_CACHE_BACKEND:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.dummy.DummyCache",
        }
    }

USE_SILK = env_bool("USE_SILK")
USE_DEBUG_TOOLBAR = env_bool("USE_DEBUG_TOOLBAR", default=not USE_SILK)

if USE_SILK and USE_DEBUG_TOOLBAR:
    raise ImproperlyConfigured(
        "Включите только один профилировщик: USE_SILK или USE_DEBUG_TOOLBAR."
    )

if USE_SILK:
    INSTALLED_APPS += [  # noqa: F405
        "silk",
    ]

    MIDDLEWARE += [  # noqa: F405
        "silk.middleware.SilkyMiddleware",
    ]

if USE_DEBUG_TOOLBAR:
    INSTALLED_APPS += [  # noqa: F405
        "debug_toolbar",
    ]

    # Как можно раньше, но после WhiteNoise, который может кодировать ответ.
    MIDDLEWARE.insert(  # noqa: F405
        2, "debug_toolbar.middleware.DebugToolbarMiddleware"
    )
    INTERNAL_IPS = ["127.0.0.1"]
