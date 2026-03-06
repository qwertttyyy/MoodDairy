from __future__ import annotations

import base64
import os

from django.contrib.auth import login, logout
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import (
    LoginSerializer,
    ProfileSerializer,
    RegisterSerializer,
    UserSerializer,
)

WRAPPING_KEY_SESSION_KEY = "wrapping_key"
WRAPPING_KEY_BYTES = 32


def _generate_wrapping_key() -> str:
    """32 случайных байта → base64."""
    return base64.b64encode(os.urandom(WRAPPING_KEY_BYTES)).decode("ascii")


def _store_wrapping_key(request: Request) -> str:
    """Генерирует wrapping_key, сохраняет в сессию, возвращает base64."""
    key = _generate_wrapping_key()
    request.session[WRAPPING_KEY_SESSION_KEY] = key
    request.session.save()
    return key


class RegisterView(APIView):
    """Регистрация: создаёт User + UserProfile(salt), отдаёт wrapping_key."""

    permission_classes = (AllowAny,)

    def post(self, request: Request) -> Response:
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        login(request, user)
        wrapping_key = _store_wrapping_key(request)
        return Response(
            {
                **UserSerializer(user).data,
                "wrapping_key": wrapping_key,
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    """Вход: аутентификация, новый wrapping_key в сессию."""

    permission_classes = (AllowAny,)

    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        login(request, user)
        wrapping_key = _store_wrapping_key(request)
        return Response(
            {
                **UserSerializer(user).data,
                "wrapping_key": wrapping_key,
            },
        )


class LogoutView(APIView):
    """Выход: удаляет wrapping_key из сессии, уничтожает сессию."""

    permission_classes = (IsAuthenticated,)

    def post(self, request: Request) -> Response:
        request.session.pop(WRAPPING_KEY_SESSION_KEY, None)
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    """Текущий пользователь."""

    permission_classes = (IsAuthenticated,)

    def get(self, request: Request) -> Response:
        return Response(UserSerializer(request.user).data)


class ProfileView(APIView):
    """Отдаёт encryption_salt пользователя."""

    permission_classes = (IsAuthenticated,)

    def get(self, request: Request) -> Response:
        serializer = ProfileSerializer(request.user.profile)
        return Response(serializer.data)


class UnwrapKeyView(APIView):
    """Отдаёт wrapping_key из сессии для восстановления encryption_key."""

    permission_classes = (IsAuthenticated,)

    def get(self, request: Request) -> Response:
        wrapping_key = request.session.get(WRAPPING_KEY_SESSION_KEY)
        if not wrapping_key:
            return Response(
                {
                    "detail": "Wrapping key отсутствует. Требуется повторный вход."
                },
                status=status.HTTP_401_UNAUTHORIZED,
            )
        return Response({"wrapping_key": wrapping_key})
