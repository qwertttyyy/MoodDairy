"""Настройки локальной разработки.

Запуск: python manage.py runserver (модуль подставляется по умолчанию
в manage.py). Боевые настройки живут в prod.py и включаются переменной
DJANGO_SETTINGS_MODULE в Dockerfile.
"""

from .base import *  # noqa: F403

DEBUG = True

# Локально сайт открывается по http, поэтому Secure-куки браузер не отдаст.
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
