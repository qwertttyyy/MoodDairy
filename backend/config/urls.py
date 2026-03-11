from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.generic import TemplateView

from config import settings

app_view = ensure_csrf_cookie(
    TemplateView.as_view(
        template_name="index.html",
        extra_context={"encryption_enabled": settings.ENCRYPTION_ENABLED},
    )
)

urlpatterns = [
    path("", app_view, name="app"),
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("entries.urls")),
]

if settings.DEBUG:
    urlpatterns += static(
        settings.STATIC_URL, document_root=settings.STATIC_ROOT
    )
