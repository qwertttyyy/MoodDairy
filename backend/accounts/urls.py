from django.urls import path

from .views import (
    LoginView,
    LogoutView,
    MeView,
    ProfileView,
    RegisterView,
    UnwrapKeyView,
)

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("login/", LoginView.as_view(), name="login"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("me/", MeView.as_view(), name="me"),
    path("profile/", ProfileView.as_view(), name="profile"),
    path("unwrap-key/", UnwrapKeyView.as_view(), name="unwrap-key"),
]
