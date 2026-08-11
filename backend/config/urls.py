"""Корневые роуты бэкенда.

SPA (включая страницу врача `/share/<token>/`) раздаёт nginx сервера из
собранной статики фронтенда, поэтому Django обслуживает только API и админку.
"""

from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("core.urls")),
    path("api/", include("entries.urls")),
    path("api/sharing/", include("sharing.urls")),
]
