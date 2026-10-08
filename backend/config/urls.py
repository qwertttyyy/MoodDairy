"""Корневые маршруты API и административного интерфейса Django."""

from django.conf import settings
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("core.urls")),
    path("api/", include("entries.urls")),
    path("api/sharing/", include("sharing.urls")),
]


if settings.DEBUG and settings.USE_SILK:
    urlpatterns += [
        path("silk/", include("silk.urls", namespace="silk")),
    ]

if settings.DEBUG and settings.USE_DEBUG_TOOLBAR:
    from debug_toolbar.toolbar import debug_toolbar_urls

    urlpatterns += debug_toolbar_urls()
