from __future__ import annotations

import logging

from django.contrib.auth import login, logout
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from core.authentication import CsrfEnforcedSessionAuthentication
from core.exceptions import WrappingKeyMissing

from .models import UserProfile
from .serializers import (
    LoginSerializer,
    ProfileSerializer,
    RegisterSerializer,
    UserSerializer,
)
from .services import (
    authenticate_user,
    clear_wrapping_key,
    get_wrapping_key,
    store_wrapping_key,
)

logger = logging.getLogger("accounts")


class RegisterView(APIView):
    """Регистрация: создаёт User + UserProfile(salt), отдаёт wrapping_key.

    CSRF проверяется явным классом аутентификации: штатный
    SessionAuthentication для анонимных запросов проверку пропускает.
    """

    permission_classes = (AllowAny,)
    authentication_classes = (CsrfEnforcedSessionAuthentication,)
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        login(request, user)
        wrapping_key = store_wrapping_key(request)
        logger.info("User registered: %s (id=%d)", user.username, user.id)
        return Response(
            {
                **UserSerializer(user).data,
                "wrapping_key": wrapping_key,
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    """Вход: аутентификация, новый wrapping_key в сессию.

    Без проверки CSRF возможна атака login CSRF: жертву незаметно логинят
    в аккаунт атакующего, и она продолжает писать записи туда.
    """

    permission_classes = (AllowAny,)
    authentication_classes = (CsrfEnforcedSessionAuthentication,)
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "auth"

    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = authenticate_user(**serializer.validated_data)
        login(request, user)
        wrapping_key = store_wrapping_key(request)
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
        clear_wrapping_key(request)
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
        # get_object_or_404 вместо request.user.profile: у пользователей,
        # созданных через createsuperuser или админку, профиля нет, и
        # обращение к связи давало бы 500 вместо понятного ответа.
        profile = get_object_or_404(UserProfile, user=request.user)
        return Response(ProfileSerializer(profile).data)


class UnwrapKeyView(APIView):
    """Отдаёт wrapping_key из сессии для восстановления encryption_key."""

    permission_classes = (IsAuthenticated,)

    def get(self, request: Request) -> Response:
        wrapping_key = get_wrapping_key(request)
        if not wrapping_key:
            logger.warning(
                "Wrapping key missing in session, user_id=%d", request.user.id
            )
            raise WrappingKeyMissing()
        return Response({"wrapping_key": wrapping_key})
