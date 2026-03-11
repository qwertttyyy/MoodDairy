from __future__ import annotations

import base64
import logging
import os

from django.contrib.auth import login, logout
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .constants import WRAPPING_KEY_BYTES, WRAPPING_KEY_SESSION_KEY
from .serializers import (
    LoginSerializer,
    ProfileSerializer,
    RegisterSerializer,
    UserSerializer,
)

logger = logging.getLogger("accounts")


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
        logger.info("User registered: %s (id=%d)", user.username, user.id)
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
        if not serializer.is_valid():
            username = request.data.get("username", "?")
            logger.warning("Login failed for username=%s", username)
            return Response(
                serializer.errors, status=status.HTTP_400_BAD_REQUEST
            )

        user = serializer.validated_data["user"]
        login(request, user)
        wrapping_key = _store_wrapping_key(request)
        logger.info("User logged in: %s (id=%d)", user.username, user.id)
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
        logger.info("User logged out: id=%d", request.user.id)
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
            logger.warning(
                "Wrapping key missing in session, user_id=%d", request.user.id
            )
            return Response(
                {
                    "detail": "Wrapping key отсутствует. Требуется повторный вход."
                },
                status=status.HTTP_401_UNAUTHORIZED,
            )
        return Response({"wrapping_key": wrapping_key})
