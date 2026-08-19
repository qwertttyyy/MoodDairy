"""Корневые маршруты API и административного интерфейса Django."""

from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("core.urls")),
    path("api/", include("entries.urls")),
    path("api/sharing/", include("sharing.urls")),
]
