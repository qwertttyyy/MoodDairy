from django.urls import path

from .views import ConfigView, HealthView

urlpatterns = [
    path("config/", ConfigView.as_view(), name="config"),
    path("health/", HealthView.as_view(), name="health"),
]
