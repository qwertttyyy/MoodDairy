"""Настройки Django для production-окружения."""

from config.env import env_int, env_list, env_str

from .base import *  # noqa: F403
from .base import REDIS_DB, REDIS_HOST, REDIS_PORT

DEBUG = False

SECRET_KEY = env_str("SECRET_KEY")
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS")
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")

DATABASES["default"]["PASSWORD"] = env_str("DB_PASSWORD")  # noqa: F405

REDIS_PASSWORD = env_str("REDIS_PASSWORD")
CACHES["default"][
    "LOCATION"
] = (  # noqa: F405
    f"redis://:{REDIS_PASSWORD}@{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}"
)

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# Увеличивайте HSTS постепенно: сначала 300, затем 86400 и 31536000 секунд.
SECURE_HSTS_SECONDS = env_int("SECURE_HSTS_SECONDS", 300)

SECURE_HSTS_INCLUDE_SUBDOMAINS = True

SECURE_HSTS_PRELOAD = False

SILENCED_SYSTEM_CHECKS = [
    "security.W008",  # SECURE_SSL_REDIRECT: редирект на HTTPS делает nginx
    "security.W021",  # SECURE_HSTS_PRELOAD: в preload-список не подаёмся
]
