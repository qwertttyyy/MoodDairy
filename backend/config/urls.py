from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.generic import TemplateView

app_view = ensure_csrf_cookie(
    TemplateView.as_view(
        template_name="index.html",
        extra_context={"encryption_enabled": settings.ENCRYPTION_ENABLED},
    )
)

urlpatterns = [
    path("", app_view, name="app"),
    path(
        "share/<str:token>/",
        never_cache(TemplateView.as_view(template_name="share.html")),
        name="share-page",
    ),
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("entries.urls")),
    path("api/sharing/", include("sharing.urls")),
]

if settings.DEBUG:
    urlpatterns += static(
        settings.STATIC_URL, document_root=settings.STATIC_ROOT
    )
