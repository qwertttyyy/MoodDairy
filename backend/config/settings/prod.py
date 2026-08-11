"""Боевые настройки.

Критичные переменные перечитываются без значений по умолчанию: если переменная
не задана, приложение падает на старте с понятной ошибкой. Это осознанно —
молчаливый запуск с известным SECRET_KEY или ALLOWED_HOSTS="*" опаснее отказа.
"""

from config.env import env_int, env_list, env_str

from .base import *  # noqa: F403
from .base import REDIS_DB, REDIS_HOST, REDIS_PORT

DEBUG = False

SECRET_KEY = env_str("SECRET_KEY")
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS")
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")

DATABASES["default"]["PASSWORD"] = env_str("DB_PASSWORD")  # noqa: F405

REDIS_PASSWORD = env_str("REDIS_PASSWORD")
CACHES["default"]["LOCATION"] = (  # noqa: F405
    f"redis://:{REDIS_PASSWORD}@{REDIS_HOST}:{REDIS_PORT}/{REDIS_DB}"
)

SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# HSTS: браузер запоминает «этот домен только по HTTPS» и не отправляет первый
# HTTP-запрос, который можно перехватить (SSL stripping).
#
# Значение нельзя быстро отозвать — пока срок не истёк, браузер откажется
# открывать сайт по HTTP даже при проблемах с сертификатом. Поэтому поднимаем
# лесенкой через переменную окружения:
#   300 (5 минут, проверка) → 86400 (сутки) → 31536000 (год, рабочее значение)
SECURE_HSTS_SECONDS = env_int("SECURE_HSTS_SECONDS", 300)

# Все поддомены обслуживаются по HTTPS, поэтому правило распространяется и на
# них: иначе атаку можно провести через любой поддомен, cookie у них общие.
SECURE_HSTS_INCLUDE_SUBDOMAINS = True

# Заявка в список, вшитый в браузеры. Удаление оттуда занимает месяцы,
# включаем только осознанно и после долгой работы с годовым max-age.
SECURE_HSTS_PRELOAD = False

# Оба предупреждения относятся к осознанным решениям выше, поэтому заглушены:
# иначе `check --deploy --fail-level WARNING` в CI будет падать всегда.
SILENCED_SYSTEM_CHECKS = [
    "security.W008",  # SECURE_SSL_REDIRECT: редирект на HTTPS делает nginx
    "security.W021",  # SECURE_HSTS_PRELOAD: в preload-список не подаёмся
]
