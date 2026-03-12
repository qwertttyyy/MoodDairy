from django.urls import path

from .views import ShareDataView, ShareView

urlpatterns = [
    path("", ShareView.as_view(), name="share-manage"),
    path("<str:token>/data/", ShareDataView.as_view(), name="share-data"),
]
