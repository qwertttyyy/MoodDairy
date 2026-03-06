from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import MoodEntryViewSet, TagViewSet

router = DefaultRouter()
router.register("entries", MoodEntryViewSet, basename="entry")
router.register("tags", TagViewSet, basename="tag")

urlpatterns = [
    path("", include(router.urls)),
]
